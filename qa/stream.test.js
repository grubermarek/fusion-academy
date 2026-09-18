/**
 * Vlastný media server (streamy a záznamy bez YouTube) — E2E
 *
 * Spustí izolovanú appku (vlastný DATA_DIR) aj media server (vlastný MEDIA_ROOT),
 * ffmpeg odvysiela skúšobný obraz cez RTMP a overí sa celý tok:
 *   S1 tajný stream_key neunikne do verejného rozvrhu ani klientkám
 *   S2 cudzí kľúč media server odmietne, vygenerovaný kľúč prijme
 *   S3 počas vysielania appka hlási is_live + vydá token, HLS hrá len s tokenom
 *   S4 klientka bez online členstva nedostane token ani záznamy
 *   S5 po skončení vznikne záznam (krátky = skrytý), admin ho zviditeľní,
 *      klientka so Silver ho prehrá (Range → 206), admin ho zmaže aj zo servera
 *
 * Vyžaduje ffmpeg v PATH alebo FFMPEG=cesta. Porty 4531 (appka), 8031 (media HTTP), 1937 (RTMP).
 * Spustenie:  node qa/stream.test.js
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const PORT = 4531, MPORT = 8031, RTMP = 1937;
const B = 'http://localhost:' + PORT, M = 'http://localhost:' + MPORT;
const SECRET = 'qa-media-secret';
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-stream-'));
const MEDIA = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-qa-media-'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || (process.env.FFMPEG ? process.env.FFMPEG.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1') : 'ffprobe');
const F = [], OK = [];
const find = (id, t, d) => { F.push({ id, t, d }); console.log(`❌ ${id} — ${t}: ${d}`); };
const pass = t => { OK.push(t); console.log(`✅ ${t}`); };
const spi = ms => new Promise(r => setTimeout(r, ms));

async function req(p, { method = 'GET', cookie = '', body, headers = {}, base = B } = {}) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch (e) { j = txt; }
  return { status: r.status, body: j, ct: r.headers.get('content-type') || '', cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const rd = f => { const m = {}; try { fs.readFileSync(path.join(DATA, f), 'utf8').split(String.fromCharCode(10)).filter(Boolean).forEach(l => { try { const o = JSON.parse(l); if (!o._id) return; if (o.$$deleted) delete m[o._id]; else m[o._id] = o; } catch (e) {} }); } catch (e) {} return Object.values(m); };
const w = (f, rows) => fs.writeFileSync(path.join(DATA, f), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const mail = id => id.toLowerCase() + '@qa-biz.local';
async function login(id) {
  const l = await req('/api/login', { method: 'POST', body: { email: mail(id), password: 'Heslo123!' } });
  if (l.status !== 200 || !l.cookie) throw new Error('prihlásenie ' + id + ' zlyhalo: ' + l.status + ' ' + JSON.stringify(l.body));
  return l.cookie;
}

(async () => {
  try { execSync(`"${FFMPEG}" -version`, { stdio: 'ignore' }); } catch (e) { console.log('❌ ffmpeg nenájdený — nastav FFMPEG=cesta'); process.exit(1); }
  const hash = bcrypt.hashSync('Heslo123!', 10);
  const U = (_id, name, extra) => ({ _id, name, email: mail(_id), password: hash, active: true, user_type: 'client',
    created_at: '2026-01-01', visit_count: 0, single_entries: 0, free_credits: 0, referral_credit: 0, sponsor_id: null, ...extra });
  w('users.db', [
    U('qaStAdmin00001', 'QA Admin', { is_admin: true, user_type: 'admin', referral_code: 'QASTADM' }),
    U('qaStTrener0001', 'QA Trénerka', { user_type: 'trainer', referral_code: 'QASTTRN' }),
    U('qaStSilver0001', 'QA Silverka', { referral_code: 'QASTSIL' }),
    U('qaStBezOnl0001', 'QA Bezonlajnka', { referral_code: 'QASTBEZ' }),
  ]);
  const plus = d => new Date(Date.now() + d * 86400e3).toISOString();
  w('memberships.db', [
    { _id: 'qaStMemSilver1', user_id: 'qaStSilver0001', plan_id: 'silver', plan_name: 'Silver', status: 'active', price: 74.9, payment_method: 'cash', created_at: '2026-09-01', expires_at: plus(20) },
    { _id: 'qaStMemBronze1', user_id: 'qaStBezOnl0001', plan_id: 'bronze', plan_name: 'Bronze', status: 'active', price: 49.9, payment_method: 'cash', created_at: '2026-09-01', expires_at: plus(20) },
  ]);
  // Pred polnocou by sa hodiny orezali na 23:59 a server by vybral inú — vtedy sa QA hodiny presunú na zajtra 08:00
  const lateNight = (new Date().getHours() * 60 + new Date().getMinutes()) + 125 > 23 * 60 + 59;
  const dow = lateNight ? (new Date().getDay() + 1) % 7 : new Date().getDay();
  // Časy hodín relatívne k teraz: prvá o 5 min (server ju vyberie ako najbližšiu/bežiacu), druhá o 65 min
  const nowM = lateNight ? 8 * 60 : new Date().getHours() * 60 + new Date().getMinutes();
  const hhmm = m => { m = Math.min(m, 23 * 60 + 59); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  w('classes.db', [
    { _id: 'qaStOnline0001', name: 'QA Stream ONLINE', emoji: '🎵', category: 'Online', location: 'Online', stream_city: 'QA Mesto', instructor: 'QA Trénerka',
      day_of_week: dow, time_start: hhmm(nowM + 5), time_end: hhmm(nowM + 60), capacity: 100, active: true, price: 10 },
    // druhá hodina z toho istého mesta v ten istý deň — zdieľa kľúč (jeden kľúč na mesto) a pri vysielaní je tiež „naživo"
    { _id: 'qaStOnline0002', name: 'QA Zumba ONLINE – LIVE', emoji: '🎵', category: 'Online', location: 'Online', stream_city: 'QA Mesto', instructor: 'QA Trénerka',
      day_of_week: dow, time_start: hhmm(nowM + 65), time_end: hhmm(nowM + 120), capacity: 100, active: true, price: 10 },
  ]);
  w('settings.db', [{ _id: 'qaStPrvy', key: 'prvy_tyzden', value: true }]);

  const clean = () => { for (const d of [DATA, MEDIA]) try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} };
  for (const [p, n] of [[B, 'appka'], [M, 'media']]) if (await fetch(p + '/').then(() => true, () => false)) { console.log(`❌ port ${p} je obsadený (${n})`); clean(); process.exit(1); }

  const media = spawn(process.execPath, ['media-server.js'], { cwd: path.join(ROOT, 'media-server'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(MPORT), RTMP_PORT: String(RTMP), MEDIA_ROOT: MEDIA, APP_URL: B, MEDIA_SECRET: SECRET, FFMPEG, FFPROBE, RETENTION_DAYS: '90' } });
  let mlog = ''; media.stdout.on('data', d => mlog += d); media.stderr.on('data', d => mlog += d);
  const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, APP_URL: B, RATE_LIMIT_OFF: '1', MAIL_CAPTURE: '1',
      MEDIA_BASE: M, MEDIA_SECRET: SECRET, RTMP_PUBLIC: `rtmp://localhost:${RTMP}/live` } });
  let slog = ''; srv.stderr.on('data', d => slog += d);
  const stopAll = () => { try { srv.kill(); } catch (e) {} try { media.kill(); } catch (e) {} };
  const t0 = Date.now(); let zije = false;
  while (Date.now() - t0 < 180000 && srv.exitCode === null) { try { await fetch(B + '/'); zije = true; break; } catch (e) { await spi(1000); } }
  if (!zije) { console.log('❌ appka nenabehla'); console.log(slog.slice(0, 1500)); stopAll(); clean(); process.exit(1); }
  let mz = false; for (let i = 0; i < 30; i++) { try { await fetch(M + '/health'); mz = true; break; } catch (e) { await spi(500); } }
  if (!mz) { console.log('❌ media server nenabehol'); console.log(mlog.slice(0, 1500)); stopAll(); clean(); process.exit(1); }
  await spi(12000); // migrácie a štartovacie joby appky

  let ff = null;
  const publish = key => spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-re',
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', '50', '-b:v', '600k',
    '-c:a', 'aac', '-b:a', '64k', '-t', '45', '-f', 'flv', `rtmp://127.0.0.1:${RTMP}/live/${key}`], { stdio: ['ignore', 'ignore', 'pipe'] });

  try {
    const admin = await login('qaStAdmin00001');
    const trener = await login('qaStTrener0001');
    const silver = await login('qaStSilver0001');
    const bez = await login('qaStBezOnl0001');
    // Migrácia online_schedule_v2 na čistej DB vypne online hodiny mimo svojho zoznamu — QA hodinu znova zapni
    const act = await req('/api/admin/classes/qaStOnline0001', { method: 'PUT', cookie: admin, body: { active: true } });
    if (act.status !== 200) throw new Error('zapnutie QA hodiny: ' + act.status + ' ' + JSON.stringify(act.body));
    await req('/api/admin/classes/qaStOnline0002', { method: 'PUT', cookie: admin, body: { active: true } });

    // ── S2a: cudzí kľúč sa odmietne ────────────────────────────────────────
    const zly = publish('cudzikluc123'); let zlyErr = ''; zly.stderr.on('data', d => zlyErr += d);
    await new Promise(r => { zly.on('exit', r); setTimeout(() => { try { zly.kill(); } catch (e) {} r(); }, 15000); });
    const liveZly = (await req('/api/streams', { base: M })).body.live || [];
    if (liveZly.length) find('S2a', 'Media server prijal vysielanie s neznámym kľúčom', JSON.stringify(liveZly));
    else pass('S2a: neznámy kľúč media server odmietol');

    // ── kľúč vygeneruje tréner ─────────────────────────────────────────────
    const kg = await req('/api/trainer/online-stream/qaStOnline0001/key', { method: 'POST', cookie: trener, body: {} });
    if (kg.status !== 200 || !kg.body.stream_key) throw new Error('generovanie kľúča: ' + kg.status + ' ' + JSON.stringify(kg.body));
    const KEY = kg.body.stream_key;
    if (!/^fa[0-9a-f]{28}$/.test(KEY)) find('S2b', 'Kľúč nemá očakávaný tvar', KEY); else pass('S2b: tréner vygeneroval kľúč ' + KEY.slice(0, 6) + '…');
    const ts = await req('/api/trainer/online-stream', { cookie: trener });
    if (!ts.body.enabled || ts.body.rtmp_url !== `rtmp://localhost:${RTMP}/live` || !(ts.body.classes || []).some(c => c.stream_key === KEY))
      find('S2c', 'Tréner nevidí RTMP adresu a kľúč', JSON.stringify(ts.body).slice(0, 300));
    else pass('S2c: tréner vidí RTMP adresu + kľúč');
    const c2k = (ts.body.classes || []).find(c => c.id === 'qaStOnline0002') || {};
    if (c2k.stream_key !== KEY) find('S2d', 'Druhá hodina z toho istého mesta nedostala rovnaký kľúč', JSON.stringify(c2k)); else pass('S2d: jeden kľúč na mesto — druhá hodina QA Mesta má ten istý');
    await spi(1500); // media server si kľúče obnoví hneď (POST /api/refresh)

    // ── S1: kľúč neunikne ──────────────────────────────────────────────────
    const pub = await req('/api/classes');
    const pubCls = (Array.isArray(pub.body) ? pub.body : []).find(c => c._id === 'qaStOnline0001');
    if (!pubCls) find('S1a', 'Verejný rozvrh nevrátil online hodinu', JSON.stringify(rd('classes.db').filter(c=>c.category==='Online').map(c=>[c._id,c.name,c.active,c.day_of_week,c.only_date||''])));
    else if (pubCls.stream_key) find('S1a', 'Verejný rozvrh prezrádza stream_key', pubCls.stream_key);
    else pass('S1a: verejný rozvrh stream_key neobsahuje');
    const oc0 = await req('/api/online/classes', { cookie: silver });
    const c0 = (oc0.body.classes || []).find(c => c._id === 'qaStOnline0001') || {};
    if (c0.stream_key) find('S1b', '/api/online/classes prezrádza stream_key', c0.stream_key);
    else if (c0.play_key !== 'qaStOnline0001' || !c0.play_token || c0.is_live !== false) find('S1b', 'Silver nemá play_key/token pred vysielaním', JSON.stringify(c0).slice(0, 300));
    else pass('S1b: klientka dostane play_key + token, nie tajný kľúč; pred vysielaním is_live=false');
    const ocA = await req('/api/classes?all=1', { cookie: admin });
    if (!(ocA.body || []).some(c => c.stream_key === KEY)) find('S1c', 'Admin nevidí kľúč v /api/classes?all=1', ''); else pass('S1c: admin kľúč vidí');

    // ── S3: vysielanie ─────────────────────────────────────────────────────
    ff = publish(KEY); let ffErr = ''; ff.stderr.on('data', d => ffErr += d);
    let live = false; for (let i = 0; i < 40; i++) { await spi(500); if (((await req('/api/streams', { base: M })).body.live || []).includes('qaStOnline0001')) { live = true; break; } }
    if (!live) { find('S3a', 'Media server nezačal vysielať s platným kľúčom', (ffErr + '\n' + mlog).slice(-800)); throw new Error('stop'); }
    pass('S3a: vysielanie s platným kľúčom beží');
    // HLS playlist sa objaví po prvých segmentoch
    const oc1 = await req('/api/online/classes', { cookie: silver });
    const c1 = (oc1.body.classes || []).find(c => c._id === 'qaStOnline0001') || {};
    if (!c1.is_live || !c1.play_token) find('S3b', 'Appka nehlási is_live po hooku start', JSON.stringify({ is_live: c1.is_live, tok: !!c1.play_token }));
    else pass('S3b: appka hlási is_live + token hneď po štarte (hook)');
    const sib = (oc1.body.classes || []).find(c => c._id === 'qaStOnline0002') || {};
    if (!sib.is_live) find('S3b2', 'Súrodenecká hodina (rovnaký kľúč, ten istý deň) nie je naživo', JSON.stringify({ is_live: sib.is_live })); else pass('S3b2: susedná hodina s rovnakým kľúčom je tiež naživo');
    let m3u = null; for (let i = 0; i < 40; i++) { await spi(500); const r = await req(`/live/qaStOnline0001/index.m3u8?t=${encodeURIComponent(c1.play_token || '')}`, { base: M }); if (r.status === 200 && /\.ts\?t=/.test(String(r.body))) { m3u = r; break; } }
    if (!m3u) find('S3c', 'HLS playlist s tokenom sa nenačítal', mlog.slice(-600));
    else {
      pass('S3c: HLS playlist s tokenom → 200, segmenty nesú token');
      const seg = String(m3u.body).split('\n').find(l => l && !l.startsWith('#'));
      const rs = await fetch(M + '/live/qaStOnline0001/' + seg);
      if (rs.status !== 200 || !/mp2t/.test(rs.headers.get('content-type') || '')) find('S3d', 'Segment sa nenačítal', rs.status + ' ' + rs.headers.get('content-type'));
      else pass('S3d: segment → 200 video/mp2t');
    }
    const bezTok = await req('/live/qaStOnline0001/index.m3u8', { base: M });
    const zlyTok = await req('/live/qaStOnline0001/index.m3u8?t=9999999999.deadbeef', { base: M });
    if (bezTok.status !== 403 || zlyTok.status !== 403) find('S3e', 'HLS hrá aj bez platného tokenu', bezTok.status + '/' + zlyTok.status);
    else pass('S3e: bez tokenu / s falošným tokenom → 403');
    // Banner na dashboarde berie len dnešné hodiny — v nočnom režime (QA hodiny zajtra) sa kontrola preskočí
    const upc = await req('/api/online/upcoming', { cookie: silver });
    if (lateNight) pass('S3f: preskočené (QA hodiny sú zajtra, banner ukazuje len dnešok)');
    else if (!upc.body.upcoming || upc.body.upcoming.media_live !== true) find('S3f', 'Dashboard banner nevie, že sa naozaj vysiela', JSON.stringify(upc.body).slice(0, 200));
    else pass('S3f: /api/online/upcoming media_live=true');
    // vstup cez /api/online/enter (Silver = full) vráti play token
    const en = await req('/api/online/enter', { method: 'POST', cookie: silver, body: { class_id: 'qaStOnline0001' } });
    if (en.status !== 200 || en.body.stream?.play_key !== 'qaStOnline0001' || !en.body.stream?.play_token) find('S3g', '/api/online/enter nevydal HLS token', en.status + ' ' + JSON.stringify(en.body).slice(0, 200));
    else pass('S3g: /api/online/enter vydá play_key + token');

    // ── S4: bez online členstva ────────────────────────────────────────────
    const oc2 = await req('/api/online/classes', { cookie: bez });
    const c2 = (oc2.body.classes || []).find(c => c._id === 'qaStOnline0001') || {};
    if (c2.play_token || c2.stream_key) find('S4a', 'Bronze klientka dostala token/kľúč', JSON.stringify(c2).slice(0, 200)); else pass('S4a: Bronze bez tokenu');
    const rec2 = await req('/api/online/recordings', { cookie: bez });
    if (rec2.status !== 403) find('S4b', 'Bronze vidí záznamy', String(rec2.status)); else pass('S4b: Bronze záznamy nevidí (403)');
    const svc = await req('/api/recordings', { base: M });
    if (svc.status !== 401) find('S4c', 'Servisné API media servera je otvorené', String(svc.status)); else pass('S4c: servisné API bez tajomstva → 401');

    // ── S5: koniec vysielania → záznam ─────────────────────────────────────
    await new Promise(r => { ff.on('exit', r); setTimeout(r, 60000); });
    let rec = null; for (let i = 0; i < 40; i++) { await spi(1000); const r = await req('/api/admin/recordings', { cookie: admin }); rec = (r.body.recordings || [])[0]; if (rec) break; }
    if (!rec) find('S5a', 'Po skončení nevznikol záznam v appke', mlog.slice(-800));
    else {
      if (rec.class_id !== 'qaStOnline0001' || !rec.file || rec.duration_s < 30 || rec.visible !== false)
        find('S5a', 'Záznam má zlé údaje (krátky má byť skrytý, dĺžka ~45 s)', JSON.stringify({ class_id: rec.class_id, file: rec.file, duration_s: rec.duration_s, visible: rec.visible, size: rec.size }));
      else pass(`S5a: záznam vznikol (${rec.duration_s} s, ${Math.round(rec.size / 1024)} kB), krátky → skrytý`);
      const liveAfter = (await req('/api/streams', { base: M })).body.live || [];
      if (liveAfter.length) find('S5b', 'Po skončení je hodina stále live', JSON.stringify(liveAfter)); else pass('S5b: po skončení nič nevysiela');
      const c3 = ((await req('/api/online/classes', { cookie: silver })).body.classes || []).find(c => c._id === 'qaStOnline0001') || {};
      if (c3.is_live) find('S5c', 'Appka hlási is_live po stop hooku', ''); else pass('S5c: appka is_live=false po stope');
      const rl0 = await req('/api/online/recordings', { cookie: silver });
      if ((rl0.body.recordings || []).length) find('S5d', 'Skrytý záznam vidí klientka', ''); else pass('S5d: skrytý záznam klientka nevidí');
      const vis = await req('/api/admin/recordings/' + rec._id, { method: 'PUT', cookie: admin, body: { visible: true, title: 'QA záznam' } });
      const rl1 = await req('/api/online/recordings', { cookie: silver });
      const r1 = (rl1.body.recordings || [])[0];
      if (vis.status !== 200 || !r1 || r1.title !== 'QA záznam' || !r1.src) find('S5e', 'Zviditeľnený záznam klientka nevidí', JSON.stringify(rl1.body).slice(0, 200));
      else {
        pass('S5e: admin zviditeľnil → klientka vidí záznam so src');
        const full = await fetch(r1.src); const rng = await fetch(r1.src, { headers: { Range: 'bytes=0-1023' } });
        if (full.status !== 200 || !/video\/mp4/.test(full.headers.get('content-type') || '') || rng.status !== 206)
          find('S5f', 'MP4 záznam sa neprehrá / Range nefunguje', full.status + ' ' + full.headers.get('content-type') + ' range=' + rng.status);
        else pass('S5f: MP4 → 200 video/mp4, Range → 206');
        const bezT = await fetch(r1.src.split('?')[0]);
        if (bezT.status !== 403) find('S5g', 'Záznam sa dá stiahnuť bez tokenu', String(bezT.status)); else pass('S5g: záznam bez tokenu → 403');
      }
      const del = await req('/api/admin/recordings/' + rec._id, { method: 'DELETE', cookie: admin });
      const files = fs.existsSync(path.join(MEDIA, 'rec', 'qaStOnline0001')) ? fs.readdirSync(path.join(MEDIA, 'rec', 'qaStOnline0001')) : [];
      const rl2 = await req('/api/admin/recordings', { cookie: admin });
      if (del.status !== 200 || files.length || (rl2.body.recordings || []).length) find('S5h', 'Mazanie záznamu nezmazalo súbor/evidenciu', JSON.stringify({ del: del.status, files, n: (rl2.body.recordings || []).length }));
      else pass('S5h: admin zmazal záznam — súbor aj evidencia preč');
    }
  } catch (e) { if (e.message !== 'stop') find('X', 'Test spadol', e.message + '\n' + (slog.slice(-500))); }
  finally { try { if (ff && ff.exitCode === null) ff.kill(); } catch (e) {} stopAll(); await spi(1500); clean(); }

  console.log(`\n${OK.length} OK, ${F.length} nálezov`);
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ ok: OK, findings: F }, null, 2));
  process.exit(F.length ? 1 : 0);
})();
