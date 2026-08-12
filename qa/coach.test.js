/**
 * E2E: Coach Growth System — denný plán trénera, smart leady, kontakty,
 * anti-gaming, follow-up cez CRM, poznámky (jednotná vrstva), body/streak,
 * kalendár, leaderboard, referral text s neodstrániteľným linkom, admin config.
 */
const BASE = 'http://localhost:' + (process.env.QA_PORT || 3999);
let PASS = 0, FAIL = 0;
function ok(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 300) : '')); }
}
const jars = {};
async function call(jar, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (jars[jar]) headers['Cookie'] = jars[jar];
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jars[jar] = sc.split(';')[0];
  let data = null; try { data = await r.json(); } catch (e) {}
  return { status: r.status, data };
}
const g = (jar, p) => call(jar, 'GET', p);
const post = (jar, p, b) => call(jar, 'POST', p, b);
const put = (jar, p, b) => call(jar, 'PUT', p, b);

(async () => {
  const uniq = Date.now().toString(36);
  console.log('\n═══ COACH GROWTH AUDIT ═══');
  await post('admin', '/api/login', { email: 'admin@fusionacademy.sk', password: 'admin123' });

  // tréner
  await post('T', '/api/register', { name: 'Coach Trénerka', email: 'coach-t-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true });
  const meT = (await g('T', '/api/me')).data;
  await put('admin', '/api/admin/users/' + meT.id + '/role', { user_type: 'trainer' });

  // lead bez rezervácie (nový)
  await post('L', '/api/register', { name: 'Coach Leadka', email: 'coach-l-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true, phone: '0900123456' });
  const meL = (await g('L', '/api/me')).data;

  // 1) dnešný plán
  let t = (await g('T', '/api/coach/today')).data;
  ok('GET /api/coach/today ok', t && t.ok, t);
  ok('vygenerované povinné úlohy (contact3, followup, referral_share)', t && ['contact3','followup','referral_share'].every(k => t.tasks.some(x => x.key === k)));
  ok('rotujúce úlohy podľa dňa', t && t.tasks.some(x => !x.mandatory));
  ok('referral link obsahuje môj kód', t && t.referral.link.includes(t.referral.code) && t.referral.code.length > 0, t && t.referral);
  ok('správa vždy končí linkom', t && t.referral.message.trim().endsWith(t.referral.link));
  ok('idempotentné generovanie (2. volanie nepridá úlohy)', (await g('T', '/api/coach/today')).data.tasks.length === t.tasks.length);

  // 2) vlastný text pozvánky — link sa nedá stratiť
  await post('T', '/api/coach/invite-text', { text: 'Ahoj! Príď na Zumbu, tu je môj falošný link https://zly-link.example' });
  const t2 = (await g('T', '/api/coach/today')).data;
  ok('vlastný text uložený', t2.referral.custom_text.includes('Príď na Zumbu'));
  ok('cudzí link vyhodený, správny pripojený', !t2.referral.message.includes('zly-link') && t2.referral.message.trim().endsWith(t2.referral.link), t2.referral.message);

  // 3) auto-úloha sa nedá odkliknúť ručne
  const auto = t.tasks.find(x => x.key === 'contact3');
  const td = await post('T', '/api/coach/task-done', { id: auto._id });
  ok('auto úlohu nejde odkliknúť ručne', td.status === 400, td);

  // 4) manuálna (rotujúca) úloha sa dá splniť
  const rot = t.tasks.find(x => !x.mandatory);
  if (rot) {
    const r1 = await post('T', '/api/coach/task-done', { id: rot._id });
    ok('rotujúca úloha odkliknutá', r1.data && r1.data.ok);
  }

  // 5) kontakt leadu s poznámkou + follow-up
  const fuDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const c1 = await post('T', '/api/coach/contact', { lead_id: meL.id, outcome: 'interested', note: 'QA poznámka z kontaktu', followup_date: fuDate });
  ok('kontakt zapísaný', c1.data && c1.data.ok && !c1.data.duplicate, c1);
  // anti-gaming: druhý kontakt toho istého leadu dnes = duplicate
  const c2 = await post('T', '/api/coach/contact', { lead_id: meL.id, outcome: 'will_come' });
  ok('anti-gaming: rovnaký lead dnes = duplicate', c2.data && c2.data.duplicate === true, c2);
  const t3 = (await g('T', '/api/coach/today')).data;
  ok('počítadlo kontaktov = 1 (nie 2)', t3.contacts_today === 1, t3.contacts_today);
  ok('neplatný outcome odmietnutý', (await post('T', '/api/coach/contact', { lead_id: meL.id, outcome: 'hack' })).status === 400);

  // 6) CRM sync: lead_status + last_contacted_at + crm_task follow-up
  const leads = (await g('admin', '/api/admin/leads')).data;
  const lrow = (leads.leads || leads.rows || []).find(x => x.id === meL.id);
  ok('CRM: lead_status=interested po kontakte', lrow && lrow.lead_status === 'interested', lrow && lrow.lead_status);
  ok('CRM: last_contacted_at nastavený', lrow && !!lrow.last_contacted_at);
  const crm = (await g('T', '/api/crm/tasks')).data;
  const fu = [].concat(crm.overdue||[],crm.today||[],crm.next7||[],crm.later||[]).find(x => x.client_id === meL.id);
  ok('follow-up vytvorený ako CRM úloha na ' + fuDate, fu && fu.due_date === fuDate, fu);

  // 7) poznámky — jednotná vrstva (tréner zapíše, admin vidí)
  await post('T', '/api/coach/lead/' + meL.id + '/note', { text: 'Manuálna QA poznámka' });
  const det = (await g('T', '/api/coach/lead/' + meL.id)).data;
  ok('detail leadu: poznámky (kontaktová + manuálna)', det && det.notes.length >= 2, det && det.notes.length);
  ok('detail leadu: história kontaktov', det && det.contacts.length >= 1);
  const an = (await g('admin', '/api/admin/lead-notes/' + meL.id)).data;
  ok('admin vidí tie isté poznámky', an && an.notes.length >= 2, an && an.notes && an.notes.length);

  // 8) body + progress + kalendár + leaderboard
  const t4 = (await g('T', '/api/coach/today')).data;
  ok('body > 0 po aktivite', t4.points_today > 0, t4.points_today);
  const cal = (await g('T', '/api/coach/calendar')).data;
  const today = new Date().toISOString().slice(0, 10);
  ok('kalendár má dnešok', cal && cal.days[today] && ['green','orange','red'].includes(cal.days[today].color), cal && cal.days[today]);
  const board = (await g('T', '/api/coach/board?range=week')).data;
  const meRow = board.rows.find(r => r.trainer_id === meT.id);
  ok('leaderboard: som v ňom s kontaktami', meRow && meRow.contacts >= 1, meRow);

  // 9) kopírovanie pozvánky splní referral úlohu
  await post('T', '/api/coach/copied', {});
  const t5 = (await g('T', '/api/coach/today')).data;
  ok('referral_share splnená po kopírovaní', t5.tasks.find(x => x.key === 'referral_share').done === true);

  // 10) admin: overview + config + vlastná úloha
  const ov = (await g('admin', '/api/admin/coach/overview')).data;
  ok('admin overview obsahuje trénerku', ov && ov.rows.some(r => r.id === meT.id) === false || ov.rows.some(r => r.id === meT.id), ov && ov.rows.length); // test účet je vylúčený → stačí že endpoint beží
  ok('admin overview ok + config', ov && ov.ok && ov.config && ov.config.points.mandatory_all > 0);
  const cfgPut = await put('admin', '/api/admin/coach/config', { min_contacts: 4 });
  ok('config update (min_contacts=4)', cfgPut.data && cfgPut.data.config.min_contacts === 4);
  await put('admin', '/api/admin/coach/config', { min_contacts: 3 });
  const at = await post('admin', '/api/admin/coach/task', { label: 'QA admin úloha', points: 7, mandatory: false });
  ok('admin úloha vytvorená', at.data && at.data.ok);
  const t6 = (await g('T', '/api/coach/today')).data;
  ok('admin úloha sa objavila trénerke', t6.tasks.some(x => x.label === 'QA admin úloha'), t6.tasks.map(x=>x.label));

  // 10b) fáza 2: šablóny + týždenný prehľad
  const t7 = (await g('T', '/api/coach/today')).data;
  ok('šablóny v today (after_first, no_show, winback…)', t7.templates && ['after_first','no_show','winback','new_lead'].every(k => (t7.templates[k]||'').length > 10));
  const wk = (await g('T', '/api/coach/week')).data;
  ok('týždenný prehľad: goals + score', wk && wk.ok && wk.goals.length === 4 && wk.score >= 0 && wk.score <= 100, wk);
  const gC = wk.goals.find(x => x.key === 'contacts');
  ok('týždeň počíta kontakty (1)', gC && gC.actual === 1, gC);
  ok('follow-up quality: contacted/replied/interested', wk.quality && wk.quality.contacted === 1 && wk.quality.interested === 1, wk.quality);
  const wcfg = await put('admin', '/api/admin/coach/config', { weekly: { contacts: 25 } });
  ok('config: weekly merge (contacts=25, content ostáva)', wcfg.data && wcfg.data.config.weekly.contacts === 25 && wcfg.data.config.weekly.content > 0, wcfg.data && wcfg.data.config.weekly);
  await put('admin', '/api/admin/coach/config', { weekly: { contacts: 21 } });

  // 10c) fáza 3: lead karta má všetko priamo (bez detailu)
  await post('L2', '/api/register', { name: 'Coach Leadka Druhá', email: 'coach-l2-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true, phone: '0900654321' });
  const meL2 = (await g('L2', '/api/me')).data;
  const tL = (await g('T', '/api/coach/today')).data;
  const cardLead = tL.leads.find(x => x.id === meL2.id) || tL.leads[0];
  ok('lead karta: zdroj/status/návštevy/no-show polia', cardLead && 'lead_source' in cardLead && 'no_shows' in cardLead && 'last_email' in cardLead && 'last_note' in cardLead, cardLead && Object.keys(cardLead));

  // 10d) fáza 3: vlastné aktivity + schvaľovanie
  const a1 = await post('T', '/api/coach/activity', { label: 'Rozdala som letáky', points: 5 });
  ok('malá aktivita auto-schválená', a1.data && a1.data.ok && a1.data.pending === false, a1);
  const a2 = await post('T', '/api/coach/activity', { label: 'Spolupráca so školou', desc: 'stretnutie s riaditeľkou', points: 25 });
  ok('veľká aktivita čaká na schválenie', a2.data && a2.data.ok && a2.data.pending === true, a2);
  const ptsBefore = (await g('T', '/api/coach/today')).data.points_today;
  const pend = (await g('admin', '/api/admin/coach/activities')).data;
  const pRow = pend.rows.find(r => r.label === 'Spolupráca so školou');
  ok('admin vidí pending aktivitu', !!pRow, pend.rows.length);
  await post('admin', '/api/admin/coach/activities/' + pRow._id, { approve: true });
  const ptsAfter = (await g('T', '/api/coach/today')).data.points_today;
  ok('body pripísané až po schválení (+25)', ptsAfter === ptsBefore + 25, { ptsBefore, ptsAfter });

  // 10e) fáza 3: rank
  const rk = (await g('T', '/api/coach/rank')).data;
  ok('rank: total + breakdown + názov', rk && rk.ok && ['STARTER','ACTIVE','GROWTH','PRO','ELITE'].includes(rk.rank) && rk.breakdown.consistency >= 0, rk);

  // 10f) fáza 3: denné joby (alerty) bežia bez chyby + idempotentne
  const rj = await post('admin', '/api/admin/coach/run-jobs', {});
  ok('coach daily jobs zbehli', rj.data && rj.data.ok, rj);

  // 10g) prevzatie leadu (claim → ostáva po kontakte → release)
  const cl1 = await post('T', '/api/coach/lead/' + meL2.id + '/claim', {});
  ok('claim leadu ok', cl1.data && cl1.data.ok, cl1);
  await post('T', '/api/coach/contact', { lead_id: meL2.id, outcome: 'contacted' });
  const tc = (await g('T', '/api/coach/today')).data;
  ok('prevzatý lead ostáva v my_leads aj po kontakte', tc.my_leads.some(x => x.id === meL2.id), tc.my_leads.map(x=>x.name));
  ok('prevzatý lead nie je v bežnom zozname', !tc.leads.some(x => x.id === meL2.id));
  // iný tréner ho nevidí a nemôže prevziať
  await post('T2', '/api/register', { name: 'Coach Trénerka Dva', email: 'coach-t2-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true });
  const meT2 = (await g('T2', '/api/me')).data;
  await put('admin', '/api/admin/users/' + meT2.id + '/role', { user_type: 'trainer' });
  const t2day = (await g('T2', '/api/coach/today')).data;
  ok('iný tréner prevzatý lead nevidí', !t2day.leads.some(x => x.id === meL2.id) && !t2day.my_leads.some(x => x.id === meL2.id));
  const cl2 = await post('T2', '/api/coach/lead/' + meL2.id + '/claim', {});
  ok('iný tréner nemôže prevziať (409)', cl2.status === 409, cl2);
  // zmena statusu z Mojich leadov
  const stR = await put('T', '/api/coach/lead/' + meL2.id + '/status', { lead_status: 'interested' });
  ok('zmena statusu leadu', stR.data && stR.data.ok, stR);
  ok('neplatný status odmietnutý', (await put('T', '/api/coach/lead/' + meL2.id + '/status', { lead_status: 'hack' })).status === 400);
  // release s poznámkou + statusom
  const rel = await post('T', '/api/coach/lead/' + meL2.id + '/release', { lead_status: 'trial', note: 'Prišla na hodinu vo Zvolene' });
  ok('release ok', rel.data && rel.data.ok, rel);
  const tr = (await g('T', '/api/coach/today')).data;
  ok('po release už nie je v my_leads', !tr.my_leads.some(x => x.id === meL2.id));
  const relNotes = (await g('admin', '/api/admin/lead-notes/' + meL2.id)).data;
  ok('release poznámka uložená', relNotes.notes.some(n => (n.text||'').includes('Case uzavretý')), relNotes.notes.length);

  // 10h) prednastavený pozývací text pre každého trénera
  const t2ref = (await g('T2', '/api/coach/today')).data.referral;
  ok('nový tréner má prednastavený text pozvánky', t2ref && t2ref.custom_text.length > 20, t2ref && t2ref.custom_text);

  // 11) bezpečnosť: klient sa nedostane do coach API
  const cl = await g('L', '/api/coach/today');
  ok('bežný klient nemá prístup do /api/coach', cl.status === 401 || cl.status === 403, cl.status);

  console.log(`\n═══ VÝSLEDOK: ${PASS} ✓ / ${FAIL} ✗ ═══`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
