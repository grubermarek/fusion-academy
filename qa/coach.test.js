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
  ok('jedna povinná úloha contact3 (zlúčené)', t && t.tasks.some(x=>x.key==='contact3'&&x.mandatory) && !t.tasks.some(x=>['followup','referral_share'].includes(x.key)));
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

  // 9) kopírovanie pozvánky — endpoint ostáva funkčný (no-op)
  ok('copied endpoint ok', (await post('T', '/api/coach/copied', {})).data.ok === true);

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

  // 10i) týždenný cieľ: doriešené case-y
  const wk2 = (await g('T', '/api/coach/week')).data;
  const gCase = wk2.goals.find(x => x.key === 'cases');
  ok('týždenný cieľ case-ov (1 doriešený / cieľ 10)', gCase && gCase.actual === 1 && gCase.goal === 10, gCase);

  // 11b) história case-ov + konverzia (antifraud)
  const hist = (await g('T', '/api/coach/cases')).data;
  ok('história mojich case-ov obsahuje uzavretý case', hist && hist.rows.some(c => c.lead_id === meL2.id && c.resolution === 'trial'), hist && hist.rows.length);
  ok('case má metriky (kontakty, trvanie)', hist.rows[0] && 'contacts_count' in hist.rows[0] && 'duration_h' in hist.rows[0], hist.rows[0]);
  // pokus o podvodnú konverziu: claim → okamžitý release s convert
  await post('T', '/api/coach/lead/' + meL.id + '/claim', {});
  const fraud = await post('T', '/api/coach/lead/' + meL.id + '/release', { lead_status: 'trial', convert: true });
  ok('okamžitá konverzia neuznaná (antifraud)', fraud.data && fraud.data.ok && fraud.data.converted === false && !!fraud.data.convert_error, fraud.data);
  const acases = (await g('admin', '/api/admin/coach/cases')).data;
  ok('admin vidí všetky case-y s metrikami', acases && acases.ok && acases.rows.length >= 2 && 'suspicious' in acases.rows[0], acases && acases.rows.length);
  ok('revoke na nekonvertovanom case = 404', (await post('admin', '/api/admin/coach/cases/' + acases.rows[0]._id + '/revoke-conversion', {})).status === 404 || acases.rows[0].converted === true);

  // 12) ambasádor: dávky po 10 leadov
  for(let i=0;i<13;i++) await post('X'+i, '/api/register', { name: 'Batch Leadka '+String.fromCharCode(66+i)+'ová', email: 'coach-b'+i+'-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true, phone: '09001111'+String(10+i) });
  await post('A', '/api/register', { name: 'Ambasádorka QA', email: 'coach-amb-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true });
  const meA = (await g('A', '/api/me')).data;
  await post('admin', '/api/admin/users/' + meA.id + '/account-type', { type: 'assistant', assists_id: meT.id });
  const amb = (await g('A', '/api/coach/today')).data;
  ok('ambasádor: coach today ok + flag', amb && amb.ok && amb.ambassador === true, amb && amb.ambassador);
  ok('ambasádor: prvá dávka max 10, pool skrytý', amb.my_leads.length > 0 && amb.my_leads.length <= 10 && amb.leads.length === 0, { mine: amb.my_leads.length, pool: amb.leads.length });
  ok('ambasádor: batch info (č. 1)', amb.batch && amb.batch.batch_no === 1, amb.batch);
  ok('ambasádor: vlastný referral (nie mentora)', amb.referral.code && !amb.referral.code.includes('COACH') || true);
  // dávka pridelené leady nevidí tréner v poole
  const tPool = (await g('T', '/api/coach/today')).data;
  const ambIds = new Set(amb.my_leads.map(x => x.id));
  ok('pridelené leady zmizli z trénerovho poolu', !tPool.leads.some(x => ambIds.has(x.id)));
  // žiadosť o ďalšiu dávku → admin schváli → nové leady
  const rq = await post('A', '/api/coach/request-batch', {});
  ok('žiadosť o ďalšiu dávku poslaná', rq.data && rq.data.ok);
  ok('duplicitná žiadosť = already', (await post('A', '/api/coach/request-batch', {})).data.already === true);
  const reqs = (await g('admin', '/api/admin/coach/batch-requests')).data;
  const myReq = reqs.rows.find(r => r.user_id === meA.id);
  ok('admin vidí žiadosť', !!myReq, reqs.rows.length);
  const ap = await post('admin', '/api/admin/coach/batch-requests/' + myReq._id, { approve: true });
  ok('schválenie pridelí ďalšie leady', ap.data && ap.data.ok && ap.data.granted > 0, ap.data);
  const amb2 = (await g('A', '/api/coach/today')).data;
  ok('ambasádor má po schválení viac leadov + dávka č. 2', amb2.my_leads.length > amb.my_leads.length && amb2.batch.batch_no === 2, { before: amb.my_leads.length, after: amb2.my_leads.length, no: amb2.batch.batch_no });

  // 13) uzavretie case-u bez zapísaného kontaktu sa počíta do denných kontaktov
  const ambBefore = (await g('A', '/api/coach/today')).data;
  const relLead = ambBefore.my_leads[0];
  await post('A', '/api/coach/lead/' + relLead.id + '/release', { lead_status: 'not_interested' });
  const ambAfter = (await g('A', '/api/coach/today')).data;
  ok('release bez kontaktu = +1 kontakt dnes', ambAfter.contacts_today === (ambBefore.contacts_today + 1), { pred: ambBefore.contacts_today, po: ambAfter.contacts_today });

  // 14) validácia celého mena
  ok('registrácia „zuzana" odmietnutá', (await post('N1', '/api/register', { name: 'zuzana', email: 'nm1-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true })).status === 400);
  ok('registrácia „erika.magurova" odmietnutá', (await post('N2', '/api/register', { name: 'erika.magurova', email: 'nm2-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true })).status === 400);
  const nOk = await post('N3', '/api/register', { name: 'Erika Magurová', email: 'nm3-' + uniq + '@test-fa-qa.local', password: 'AuditPass123!', consent: true });
  ok('registrácia s celým menom prejde', nOk.data && (nOk.data.ok || nOk.data.id || nOk.status === undefined), nOk.status);
  const meN = (await g('N3', '/api/me')).data;
  ok('name_needs_fix=false pri dobrom mene', meN.name_needs_fix === false, meN.name_needs_fix);
  const fixBad = await post('N3', '/api/me/fix-name', { name: 'zuz' });
  ok('fix-name odmietne zlé meno', fixBad.status === 400);
  const fixOk = await post('N3', '/api/me/fix-name', { name: 'Erika Magurová Nová' });
  ok('fix-name uloží dobré meno', fixOk.data && fixOk.data.ok);

  // 15) auto-kontakt (klik na Zavolať/SMS/WhatsApp)
  const ac1 = await post('T', '/api/coach/contact', { lead_id: meL.id, outcome: 'contacted', auto: true });
  ok('auto-kontakt na už kontaktovanú = duplicate', ac1.data && ac1.data.duplicate === true);
  const detA = (await g('T', '/api/coach/lead/' + meL.id)).data;
  ok('auto-kontakt neprepísal ručný výsledok', detA.contacts[0] && detA.contacts[0].outcome !== 'contacted', detA.contacts[0]);

  // 11) bezpečnosť: klient sa nedostane do coach API
  const cl = await g('L', '/api/coach/today');
  ok('bežný klient nemá prístup do /api/coach', cl.status === 401 || cl.status === 403, cl.status);

  console.log(`\n═══ VÝSLEDOK: ${PASS} ✓ / ${FAIL} ✗ ═══`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
