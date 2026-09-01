/**
 * Ručný predaj (admin → „Zaznamenať predaj") musí skončiť rovnako ako každý
 * iný predaj: v zozname predajov, s typom a s faktúrou.
 *
 * Marek 1. 9.: „v predaje a faktury stale nevidim napriklad predaj merchu".
 * Merch sa zapisoval bez typu a bez dokladu — v účtovníctve po ňom nezostala stopa.
 *
 * Spustenie:  node qa/rucny-predaj.test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4566;
const BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-rp-'));

let passed = 0, failed = 0;
const ok = (n, c, note) => { if (c) { passed++; console.log('  ✅ ' + n); } else { failed++; console.log('  ❌ ' + n + (note ? ' — ' + note : '')); } };

async function j(url, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (jar && jar.cookie) headers['Cookie'] = jar.cookie;
  const r = await fetch(BASE + url, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (jar) { const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; }
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };

(async () => {
  const hash = bcrypt.hashSync('Heslo123!', 10);
  fs.writeFileSync(path.join(DATA, 'users.db'), [
    JSON.stringify({ _id: 'qaRpAdmin000001', name: 'Adam Admin', email: 'qa.rp.admin@qa-biz.local',
      password: hash, is_admin: true, user_type: 'admin', active: true, created_at: '2026-01-01' }),
    JSON.stringify({ _id: 'qaRpKlientka001', name: 'Klara Merchova', email: 'qa.rp.klientka@qa-biz.local',
      password: hash, user_type: 'client', active: true, referral_code: 'QARP01',
      visit_count: 3, created_at: '2026-06-01', city: 'Detva' }),
  ].join('\n') + '\n');

  // starý merch predaj bez typu a bez faktúry — migrácia ho má dorovnať
  fs.writeFileSync(path.join(DATA, 'transactions.db'),
    JSON.stringify({ _id: 'qaRpStary000001', client_id: 'qaRpKlientka001', client_name: 'Klara Merchova',
      product_name: 'Taška Fusion Academy (Čierna)', amount: 30, date: '2026-07-19',
      created_at: '2026-07-19T10:00:00.000Z', payment_method: 'cash' }) + '\n');

  console.log('RUČNÝ PREDAJ QA — štart servera…');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: BASE, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let chyba = ''; srv.stderr.on('data', d => { chyba += d; });
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000) { try { await fetch(BASE + '/'); zije = true; break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  if (!zije) { console.log('  ❌ server nenabehol'); console.log(chyba.slice(0, 1200)); process.exit(1); }

  try {
    const adm = {};
    const lg = await j('/api/login', { method: 'POST', body: { email: 'qa.rp.admin@qa-biz.local', password: 'Heslo123!' } }, adm);
    ok('admin prihlásený', lg.status === 200, JSON.stringify(lg.d));

    console.log('\nNový ručný predaj merchu:');
    const p = await j('/api/admin/transactions', { method: 'POST', body: {
      client_id: 'qaRpKlientka001', client_name: 'Klara Merchova',
      product_name: 'Tričko Fusion Academy (veľ. M · Čierna)', amount: 20,
      date: '2026-09-01', payment_method: 'cash' } }, adm);
    ok('predaj sa zapíše', p.status === 200 || p.status === 201, 'HTTP ' + p.status + ' ' + JSON.stringify(p.d).slice(0, 90));
    await new Promise(r => setTimeout(r, 1200));

    const tx = rd('transactions.db').find(t => t.product_name && t.product_name.includes('Tričko'));
    ok('má vyplnený typ (bez neho vypadne z tržieb)', tx && tx.type === 'product', tx ? String(tx.type) : 'transakcia nenájdená');

    const fa = rd('invoices.db');
    const moja = fa.find(i => Math.abs(+i.total - 20) < 0.01);
    ok('vznikla k nemu faktúra', !!moja, 'faktúry: ' + JSON.stringify(fa.map(i => i.number + ':' + i.total)));
    if (moja) {
      ok('faktúra je na správnu klientku', moja.user_id === 'qaRpKlientka001', String(moja.user_id));
      ok('a nesie názov produktu', JSON.stringify(moja.items || []).includes('Tričko'), JSON.stringify(moja.items));
    }

    // Migrácie štartujú so setTimeout 10 a 11 s, nech nenarazia na TDZ neskorších const
    console.log('\nDorovnanie starých predajov (migrácia beží 11 s po štarte, čakám)…');
    await new Promise(r => setTimeout(r, 13000));
    const fa2 = rd('invoices.db');
    const staraFa = fa2.find(i => Math.abs(+i.total - 30) < 0.01);
    ok('starý merch bez dokladu dostal faktúru spätne', !!staraFa,
      'faktúry: ' + JSON.stringify(fa2.map(i => i.number + ':' + i.total)));
    const staraTx = rd('transactions.db').find(t => t._id === 'qaRpStary000001');
    ok('a doplnil sa mu aj typ', staraTx && staraTx.type === 'product', staraTx ? String(staraTx.type) : '—');

    console.log('\nŽiadne maily klientkam:');
    const maily = rd('mail_log.db').filter(m => /klientka/.test(String(m.to || '')));
    ok('spätné dopĺňanie nikomu nenapísalo', maily.length === 0,
      JSON.stringify(maily.map(m => m.subject)).slice(0, 120));

    console.log('\nPredaj je vidieť v zozname aj v tržbách:');
    const zoznam = (await j('/api/transactions', {}, adm)).d || [];
    ok('„Všetky predaje" ho ukazuje', zoznam.some(t => String(t.product_name || '').includes('Tričko')),
      zoznam.length + ' riadkov');
    const fin = (await j('/api/admin/finance/stats?from=2026-09-01&to=2026-09-30', {}, adm)).d;
    ok('a je započítaný v tržbách', fin && fin.revenue && +fin.revenue.period >= 20,
      'revenue.period=' + (fin && fin.revenue ? fin.revenue.period : '—'));

  } catch (e) {
    failed++; console.log('  ❌ výnimka: ' + e.message);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\nRUČNÝ PREDAJ: ' + passed + ' OK / ' + failed + ' chýb');
    setTimeout(() => process.exit(failed ? 1 : 0), 400);
  }
})();
