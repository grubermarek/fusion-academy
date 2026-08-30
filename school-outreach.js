/**
 * Oslovenie základných škôl — program „Posledný tanec" (venček pre 9. ročník).
 *
 * Načo to je: reklamy oslovia rodičov, ale o venčeku rozhoduje vedenie školy.
 * Toto je studené oslovenie riaditeľov s jediným cieľom — dostať ich na sekciu
 * „Pre školy" na landing page, kde je dopytový formulár aj telefón.
 *
 * Prečo cez appku a nie z mailboxu: takto vidíme, ktorá škola mail otvorila a klikla
 * (mail_log + FUNNEL-012 click tracking). Vieme sa cielene ozvať tým, čo prejavili
 * záujem, a nikomu neposielame dvakrát. Bez toho je cold outreach strieľanie naslepo.
 *
 * Fakty v maile pochádzajú z overeného zoznamu (venceky/PROMPTY-A-TEXTY.md) a zo
 * živej landing page fusionacademy.sk/programy/posledny-tanec.html — nič sa nedomýšľa.
 */
'use strict';
const path = require('path');

module.exports = function initSchoolOutreach(ctx) {
  const { app, db, q, Datastore, DATA_DIR, adminAuth, nowISO, APP_URL, sendMail } = ctx;

  db.schools = new Datastore({ filename: path.join(DATA_DIR, 'schools.db'), autoload: true });
  db.schools.ensureIndex({ fieldName: 'email' });

  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── Kam mail smeruje ────────────────────────────────────────────────────────
  // Kotva ide až za parametrami, inak ju prehliadač zoberie aj s utm reťazcom.
  const LP = 'https://fusionacademy.sk/programy/posledny-tanec.html';
  const UTM = 'utm_source=email&utm_medium=outreach&utm_campaign=posledny-tanec-skoly';
  const lpUrl = s => LP + '?' + UTM + '&utm_content=' + encodeURIComponent(s.city || 'sk')
    + (s._id && s._id !== 'ukazka' ? '&sid=' + encodeURIComponent(s._id) : '') + '#pre-skoly';
  const TEL = '0904 31 51 51';

  // ── Text mailu ──────────────────────────────────────────────────────────────
  // Zámerne NEpoužívame farebnú newsletter šablónu z appky. Studený mail riaditeľovi
  // má vyzerať ako list od človeka, nie ako reklamná pošta — inak ho oko preskočí
  // (a spam filtre bývajú prísnejšie na obrázkové HTML).
  function subjectFor(s) {
    return 'Venček pre deviatakov' + (s.city ? ' — ' + s.city : '') + ': školu nestojí žiadnu organizáciu';
  }

  function htmlFor(s) {
    const oslovenie = s.director ? 'Dobrý deň, ' + esc(s.director) + ',' : 'Dobrý deň,';
    const skola = s.name ? ' na škole ' + esc(s.name) : ' u vás';
    const odhlasit = APP_URL + '/skoly/odhlasit/' + s._id;
    const cta = lpUrl(s);
    return `<!DOCTYPE html><html lang="sk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f1ee">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f1ee">
<tr><td align="center" style="padding:26px 14px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0"
  style="max-width:600px;background:#ffffff;border-radius:10px;border:1px solid #e3e0d9">
<tr><td style="padding:30px 34px 6px;font-family:Georgia,'Times New Roman',serif;
    font-size:16px;line-height:1.65;color:#222">

  <p style="margin:0 0 16px">${oslovenie}</p>

  <p style="margin:0 0 16px">volám sa Marek Gruber z tanečnej školy Fusion Academy.
  Pre deviatakov robíme program <b>Posledný tanec</b> — modernú obdobu venčeka.
  Píšem vám preto, že venček${skola} vieme zastrešiť tak, že škola nerieši nič.</p>

  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:6px 0 18px">
    <tr><td style="padding:7px 10px 7px 0;vertical-align:top;font-size:15px">🎓</td>
        <td style="padding:7px 0;font-size:15px;line-height:1.6;color:#222">
        <b>Organizáciu držíme my.</b> 13 lekcií (10 + 3 bonusové zadarmo), moderné tance
        aj etiketa a na záver celý galavečer — DJ, moderátor, fotograf, kameraman,
        fotostena, výzdoba. Termíny lekcií aj večera si škola vyberie sama.</td></tr>
    <tr><td style="padding:7px 10px 7px 0;vertical-align:top;font-size:15px">💶</td>
        <td style="padding:7px 0;font-size:15px;line-height:1.6;color:#222">
        <b>3 € za každého prihláseného žiaka idú škole</b> ako účelový príspevok — pri 25
        žiakoch 75 €, pri 50 žiakoch 150 €. Rodič platí 49,90 € kartou priamo v našej
        aplikácii a dostane potvrdenie e-mailom aj fyzicky.
        <b>Cez triedneho učiteľa neprejde ani euro v hotovosti.</b></td></tr>
    <tr><td style="padding:7px 10px 7px 0;vertical-align:top;font-size:15px">✨</td>
        <td style="padding:7px 0;font-size:15px;line-height:1.6;color:#222">
        <b>Vaša škola má svoj vlastný venček.</b> Nespájame školy do hromadnej akcie pre
        80–100 detí, kde rodič celý večer hľadá svoje dieťa. Učitelia a vedenie školy
        majú tanečné lekcie zadarmo.</td></tr>
  </table>

  <p style="margin:0 0 18px">Takto prebehol venček v <b>Podbrezovej</b>. Prvý krok je
  15-minútové stretnutie priamo u vás — ukážem video, referencie a voľné termíny.
  Počet škôl, ktoré v sezóne zoberieme, je obmedzený, lebo každej robíme vlastný večer.</p>

  <div style="text-align:center;margin:22px 0 24px">
    <a href="${cta}" style="display:inline-block;background:#C9A84C;color:#1b1405;
      padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:700;
      font-family:Arial,sans-serif;font-size:15px">Pozrieť ponuku pre školy</a>
  </div>

  <p style="margin:0 0 18px">Na stránke je sekcia pre školy aj krátky dopytový formulár.
  Alebo mi pokojne zavolajte na <b>${TEL}</b> — poviem vám voľné termíny.</p>

  <p style="margin:0 0 4px">Ďakujem za váš čas,</p>
  <p style="margin:0 0 26px;line-height:1.5">
    <b>Marek Gruber</b><br>
    <span style="font-size:14px;color:#555">majster Slovenska v plesových choreografiách · 18 rokov na parkete<br>
    Fusion Academy · ${TEL} · fusionacademy.sk</span></p>

</td></tr>
<tr><td style="padding:14px 34px 22px;border-top:1px solid #eeece7;
    font-family:Arial,sans-serif;font-size:11px;line-height:1.6;color:#8d8a83;text-align:center">
  Píšeme na verejne dostupný kontakt školy, pretože ide o ponuku pre 9. ročník.
  Ak si neželáte ďalšie správy,
  <a href="${odhlasit}" style="color:#8d8a83">odhláste sa jedným klikom</a> — už vás neoslovíme.<br>
  Fusion Academy · IČO 56167563 · fusionacademy.sk
</td></tr>
</table></td></tr></table></body></html>`;
  }

  // ── Follow-up (2. dotyk po ~5 dňoch): kratší mail pre školy, ktoré neklikli ──
  function followupSubject(s) {
    return 'Ešte k venčeku' + (s.city ? ' — ' + s.city : '') + ': stačí jedno kliknutie';
  }
  function followupHtml(s) {
    const oslovenie = s.director ? 'Dobrý deň, ' + esc(s.director) + ',' : 'Dobrý deň,';
    const odhlasit = APP_URL + '/skoly/odhlasit/' + s._id;
    const cta = lpUrl(s);
    return `<!DOCTYPE html><html lang="sk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f1ee">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f1ee">
<tr><td align="center" style="padding:26px 14px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0"
  style="max-width:600px;background:#ffffff;border-radius:10px;border:1px solid #e3e0d9">
<tr><td style="padding:28px 34px 6px;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.65;color:#222">
  <p style="margin:0 0 14px">${oslovenie}</p>
  <p style="margin:0 0 14px">pred pár dňami som vám písal ohľadom venčeka pre deviatakov
  (program <b>Posledný tanec</b>). Viem, že začiatok školského roka je nápor — preto len krátko:</p>
  <p style="margin:0 0 14px">škola pri tom <b>nerieši žiadnu organizáciu</b>, rodičia platia
  v aplikácii a <b>3 € za každého prihláseného žiaka idú škole</b>. Počet škôl v sezóne je
  obmedzený a termíny sa priebežne obsadzujú.</p>
  <div style="text-align:center;margin:20px 0 22px">
    <a href="${cta}" style="display:inline-block;background:#C9A84C;color:#1b1405;
      padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:700;
      font-family:Arial,sans-serif;font-size:15px">Pozrieť ponuku pre školy</a>
  </div>
  <p style="margin:0 0 18px">Na stránke je krátky formulár — s vašimi údajmi už predvyplnený,
  stačí jedno kliknutie. Alebo mi zavolajte na <b>${TEL}</b>, poviem vám voľné termíny.</p>
  <p style="margin:0 0 4px">Pekný deň,</p>
  <p style="margin:0 0 24px;line-height:1.5"><b>Marek Gruber</b><br>
    <span style="font-size:14px;color:#555">Fusion Academy · ${TEL} · fusionacademy.sk</span></p>
</td></tr>
<tr><td style="padding:12px 34px 20px;border-top:1px solid #eeece7;
    font-family:Arial,sans-serif;font-size:11px;line-height:1.6;color:#8d8a83;text-align:center">
  Ak si neželáte ďalšie správy, <a href="${odhlasit}" style="color:#8d8a83">odhláste sa jedným klikom</a>.<br>
  Fusion Academy · IČO 56167563 · fusionacademy.sk
</td></tr>
</table></td></tr></table></body></html>`;
  }

  // follow-up dávka: školy oslovené pred >=5 dňami, bez kliku, bez odpovede,
  // bez odhlásenia a bez už poslaného follow-upu
  async function sendFollowupBatch(limit) {
    const vsetky = await q.find(db.schools, {});
    const ids = vsetky.map(s => s.mail_log_id).filter(Boolean);
    const logy = {};
    if (ids.length) for (const l of await q.find(db.mail_log, { _id: { $in: ids } })) logy[l._id] = l;
    const hranica = Date.now() - 5 * 86400000;
    const kandidatky = vsetky.filter(s => s.sent_at && !s.followup_sent_at && !s.unsubscribed
      && !['replied', 'meeting', 'won', 'lost'].includes(s.status)
      && new Date(s.sent_at).getTime() < hranica
      && !(logy[s.mail_log_id] && logy[s.mail_log_id].clicked_at))
      .slice(0, limit);
    const capture = process.env.MAIL_CAPTURE === '1';
    let poslane = 0;
    for (const s of kandidatky) {
      const ok = await sendMail(s.email, followupSubject(s), followupHtml(s),
        { priority: 8, template: 'skoly_posledny_tanec_fu' }) || capture;
      if (!ok) continue;
      await q.update(db.schools, { _id: s._id }, { $set: { followup_sent_at: nowISO(), updated_at: nowISO() } });
      poslane++;
      await new Promise(r => setTimeout(r, 350));
    }
    return poslane;
  }

  // ── Import zoznamu škôl ─────────────────────────────────────────────────────
  // Marek nalepí zoznam z tabuľky; oddeľovač môže byť bodkočiarka, tabulátor alebo
  // čiarka. E-mail spoznáme podľa zavináča, telefón podľa tvaru, zvyšok podľa poradia.
  function parseRows(text) {
    const out = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const parts = t.split(/[\t;,]/).map(x => x.trim()).filter(Boolean);
      const email = (parts.find(p => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(p)) || '').toLowerCase();
      if (!email) continue;                       // riadok bez adresy nemá zmysel
      const zvysok = parts.filter(p => p.toLowerCase() !== email);
      const phone = zvysok.find(p => /^[+0-9][0-9 ()/+-]{8,}$/.test(p)) || '';
      const texty = zvysok.filter(p => p !== phone);
      out.push({ name: texty[0] || '', city: texty[1] || '', director: texty[2] || '', email, phone });
    }
    return out;
  }

  app.post('/api/admin/schools/import', adminAuth, async (req, res) => {
    try {
      const rows = parseRows(req.body && req.body.text);
      if (!rows.length) return res.status(400).json({
        error: 'Nenašiel som ani jeden e-mail. Každý riadok potrebuje adresu školy.' });
      let pridane = 0; const duplicity = [];
      for (const r of rows) {
        if (await q.one(db.schools, { email: r.email })) { duplicity.push(r.email); continue; }
        await q.insert(db.schools, { ...r, status: 'new', unsubscribed: false, mail_log_id: null,
          sent_at: null, note: '', created_at: nowISO(), updated_at: nowISO() });
        pridane++;
      }
      res.json({ ok: true, pridane, preskocene: duplicity.length, duplicity: duplicity.slice(0, 20) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Prehľad + štatistika ────────────────────────────────────────────────────
  async function withMail(list) {
    const ids = list.map(s => s.mail_log_id).filter(Boolean);
    const byId = {};
    if (ids.length) for (const l of await q.find(db.mail_log, { _id: { $in: ids } })) byId[l._id] = l;
    return list.map(s => ({ ...s,
      opened_at: (byId[s.mail_log_id] || {}).opened_at || null,
      clicked_at: (byId[s.mail_log_id] || {}).clicked_at || null }));
  }

  app.get('/api/admin/schools', adminAuth, async (req, res) => {
    try {
      const all = await withMail(await q.find(db.schools, {}));
      all.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const poslane = all.filter(s => s.sent_at);
      res.json({ ok: true, schools: all, totals: {
        spolu: all.length,
        cakaju: all.filter(s => !s.sent_at && !s.unsubscribed).length,
        poslane: poslane.length,
        otvorene: poslane.filter(s => s.opened_at).length,
        klikli: poslane.filter(s => s.clicked_at).length,
        odpovedali: all.filter(s => ['replied', 'meeting', 'won'].includes(s.status)).length,
        dohodnute: all.filter(s => s.status === 'won').length,
        odhlasene: all.filter(s => s.unsubscribed).length,
      } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ukážka mailu presne v podobe, v akej ho škola uvidí
  app.get('/api/admin/schools/preview', adminAuth, (req, res) => {
    const vzor = { _id: 'ukazka', name: req.query.name || 'Základná škola Kukučínova',
      city: req.query.city || 'Detva', director: req.query.director || 'pani riaditeľka' };
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send('<div style="font:13px Arial;background:#f2f1ee;padding:16px 0;text-align:center;color:#555">'
      + '<b>Predmet:</b> ' + esc(subjectFor(vzor)) + '</div>' + htmlFor(vzor));
  });

  // ── Rozposlanie po dávkach ──────────────────────────────────────────────────
  // Denný strop Breva si stráži sendMail sám; my len neposielame viac, než koľko
  // si Marek vyžiada, a nikdy dvakrát tej istej škole.
  async function sendBatch(limit, iba) {
    const cakaju = (await q.find(db.schools, {}))
      .filter(s => !s.sent_at && !s.unsubscribed && /@/.test(s.email || ''))
      .filter(s => !iba || iba.includes(s._id))
      .slice(0, limit);
    // QA hook (rovnaká konvencia ako STRIPE_FAKE / CAPI_DEBUG_FILE): v capture režime
    // sa mail zaloguje, ale NIKDY neodošle — evidenciu si aj tak chceme overiť.
    const capture = process.env.MAIL_CAPTURE === '1';
    let poslane = 0; const zlyhali = [];
    for (const s of cakaju) {
      const ok = await sendMail(s.email, subjectFor(s), htmlFor(s),
        { priority: 8, template: 'skoly_posledny_tanec' }) || capture;
      if (!ok) { zlyhali.push(s.email); continue; }
      // mail_log vzniká vnútri sendMail — dohľadáme si ten svoj, nech vieme
      // otvorenia a kliky priradiť ku konkrétnej škole
      const logy = (await q.find(db.mail_log, { to: s.email }))
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      await q.update(db.schools, { _id: s._id }, { $set: { status: 'sent', sent_at: nowISO(),
        mail_log_id: logy[0] ? logy[0]._id : null, updated_at: nowISO() } });
      poslane++;
      await new Promise(r => setTimeout(r, 350));   // nech Brevo nedostane nával
    }
    const zostava = (await q.find(db.schools, {})).filter(s => !s.sent_at && !s.unsubscribed).length;
    return { poslane, zlyhali: zlyhali.length, adresy_zlyhani: zlyhali.slice(0, 10), zostava };
  }

  app.post('/api/admin/schools/send', adminAuth, async (req, res) => {
    try {
      const limit = Math.min(120, Math.max(1, +((req.body && req.body.limit) || 25)));
      const iba = Array.isArray(req.body && req.body.ids) && req.body.ids.length ? req.body.ids : null;
      res.json({ ok: true, ...(await sendBatch(limit, iba)) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Denná automatika: rozposielanie škôl v pracovnom čase ───────────────────
  // Marek chce rozposielať automaticky. Studený outreach sa dávkuje, aby
  // nezhoršil reputáciu odosielateľa a nezožral Brevo budžet transakčným mailom.
  // Beží len na produkcii (lokál/QA maily aj tak neposiela).
  //
  // Denný strop sa dá meniť BEZ DEPLOYU cez settings 'school_drip_size'
  // (30. 8. 2026 zdvihnutý z 25 na 50 — doména je odvtedy v Brevo podpísaná
  // cez DKIM a mesačný limit stúpol na 10 000). Zvyšovať postupne: nová
  // odosielacia identita nesmie zo dňa na deň vystreliť na stovky mailov.
  //
  // Guard drží POČET odoslaného dnes, nie len „dnes bežalo". Vďaka tomu sa
  // denná dávka rozloží do viacerých behov počas dňa (menej nárazovo) a keď
  // sa strop zdvihne, zvyšok dobehne ešte v ten istý deň.
  const DRIP_DEFAULT = 50;        // škôl/deň, kým to settings neprepíše
  const DRIP_NA_BEH = 25;         // max na jeden beh, nech to nejde naraz
  const dnesSK = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date());
  const hodinaSK = () => +new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava', hour: '2-digit', hour12: false }).format(new Date());
  const naProdukcii = !!process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';
  async function schoolDrip() {
    try {
      if (!naProdukcii) return;
      const conf = await q.one(db.settings, { key: 'school_outreach_autodrip' });
      if (conf && conf.value === false) return;               // dá sa vypnúť bez deployu
      const h = hodinaSK();
      if (h < 9 || h >= 17) return;                           // len v pracovnom čase
      const cfg = await q.one(db.settings, { key: 'school_drip_size' });
      const dennyStrop = Math.min(200, Math.max(1, +(cfg && cfg.value) || DRIP_DEFAULT));
      const guard = 'school_drip_' + dnesSK();
      const zaznam = await q.one(db.settings, { key: guard });
      // Starý guard bol boolean true (= dnes bežala jedna dávka po 25). Bez tohto
      // prepočtu by sa `+true` prečítalo ako 1 a v deň nasadenia by odišlo o dávku viac.
      const uzDnes = !zaznam ? 0 : (zaznam.value === true ? 25 : (+zaznam.value || 0));
      const zostavaDnes = dennyStrop - uzDnes;
      if (zostavaDnes <= 0) return;                           // dnešný strop vyčerpaný
      const skoly = await q.find(db.schools, {});
      const maNove = skoly.some(s2 => !s2.sent_at && !s2.unsubscribed);
      // Aj keď už nie je koho osloviť prvýkrát, follow-upy musia dobehnúť —
      // pôvodná podmienka ich po dokončení zoznamu ticho zastavila.
      const maFollowup = skoly.some(s2 => s2.sent_at && !s2.followup_sent_at && !s2.unsubscribed
        && !['replied', 'meeting', 'won', 'lost'].includes(s2.status));
      if (!maNove && !maFollowup) return;                     // nie je komu — guard nezapisuj
      const davka = Math.min(DRIP_NA_BEH, zostavaDnes);
      const r = await sendBatch(davka, null);
      const fu = await sendFollowupBatch(davka);
      const spoluDnes = uzDnes + (r.poslane || 0) + (fu || 0);
      if (zaznam) await q.update(db.settings, { key: guard }, { $set: { value: spoluDnes, at: nowISO() } });
      else await q.insert(db.settings, { key: guard, value: spoluDnes, at: nowISO() });
      console.log('🎓 Školy — dávka: odoslané ' + r.poslane + ', follow-upov ' + fu
        + ', zlyhalo ' + r.zlyhali + ' | dnes spolu ' + spoluDnes + '/' + dennyStrop + ', čaká ešte ' + r.zostava);
      // Notifikácia až keď je denný strop vyčerpaný alebo zoznam dokončený —
      // inak by pri behu každých 20 minút chodila adminom celý deň.
      const hotovoNaDnes = spoluDnes >= dennyStrop || (!r.zostava && !fu);
      if (hotovoNaDnes && (r.poslane || fu))
        for (const a of await q.find(db.users, { is_admin: true }))
          await q.insert(db.notifications, { user_id: a._id, type: 'school_outreach',
            title: '🎓 Oslovenie škôl — denná dávka',
            body: 'Dnes odoslaných ' + spoluDnes + ' mailov školám' + (r.zostava ? ', čaká ešte ' + r.zostava : ' — zoznam je dokončený') + '. Prehľad: /admin/skoly',
            read: false, created_at: nowISO() }).catch(() => {});
    } catch (e) { console.error('school drip:', e.message); }
  }
  setInterval(schoolDrip, 20 * 60 * 1000);
  setTimeout(schoolDrip, 90 * 1000);   // krátko po štarte, nech deploy počas okna nečaká 20 min

  // ── Ukážka mailu na vlastné adresy: env SCHOOL_SAMPLE_TO="mail1,mail2" ──────
  setTimeout(async () => {
    try {
      const to = process.env.SCHOOL_SAMPLE_TO;
      if (!to) return;
      let hash = 0; for (let i = 0; i < to.length; i++) hash = (hash * 31 + to.charCodeAt(i)) >>> 0;
      const guard = 'school_sample_' + hash.toString(16);
      if (await q.one(db.settings, { key: guard })) return;
      await q.insert(db.settings, { key: guard, value: to, at: nowISO() });
      const vzor = { _id: 'ukazka', name: 'Základná škola — UKÁŽKA', city: 'Detva', director: 'pani riaditeľka' };
      const html = '<div style="background:#fff3cd;border:1px solid #ffc107;padding:10px 16px;'
        + 'font-family:Arial,sans-serif;font-size:13px;color:#664d03;text-align:center">'
        + '⚠️ UKÁŽKA — presne takýto mail dostávajú riaditelia škôl (s ich menom a školou)</div>'
        + htmlFor(vzor);
      for (const adresa of to.split(',').map(x => x.trim()).filter(x => /@/.test(x))) {
        const ok = await sendMail(adresa, '[UKÁŽKA] ' + subjectFor(vzor), html, { priority: 3, template: 'skoly_sample' });
        console.log('🎓 Ukážka školského mailu → ' + adresa + ': ' + (ok ? 'odoslané' : 'NEODOSLANÉ'));
        await new Promise(r => setTimeout(r, 400));
      }
    } catch (e) { console.error('school sample:', e.message); }
  }, 40 * 1000);

  // Mimoriadna dávka na Marekov pokyn (28.8.: „pošli ďalšie maily") — env
  // SCHOOL_SEND_NOW s guardom per hodnota; pošle čakajúce hneď, mimo denného okna.
  setTimeout(async () => {
    try {
      const v = process.env.SCHOOL_SEND_NOW;
      if (!v) return;
      const guard = 'school_send_now_' + String(v).replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
      if (await q.one(db.settings, { key: guard })) return;
      await q.insert(db.settings, { key: guard, value: true, at: nowISO() });
      const r = await sendBatch(25, null);
      console.log('🎓 Školy — MIMORIADNA dávka (' + v + '): odoslané ' + r.poslane + ', zlyhalo ' + r.zlyhali + ', čaká ešte ' + r.zostava);
    } catch (e) { console.error('school send now:', e.message); }
  }, 50 * 1000);

  // stavový log pri každom štarte — nech vidno počty aj bez admin prístupu
  setTimeout(async () => {
    try {
      const vs = await q.find(db.schools, {});
      console.log('🎓 Školy stav: spolu ' + vs.length + ' | odoslané ' + vs.filter(x => x.sent_at).length
        + ' | follow-up ' + vs.filter(x => x.followup_sent_at).length
        + ' | čakajú ' + vs.filter(x => !x.sent_at && !x.unsubscribed).length
        + ' | odhlásené ' + vs.filter(x => x.unsubscribed).length);
    } catch (e) {}
  }, 35 * 1000);

  // ── Jednorazový import zoznamu z env premennej (Railway) ────────────────────
  // Prod DB nie je prístupná zvonku a admin heslo nepoznáme — zoznam škôl sa
  // nasadí cez Railway env SCHOOLS_IMPORT_B64 (base64 riadkov pre parseRows).
  // Guard per obsah: rovnaký zoznam sa nenaimportuje dvakrát, nový obsah áno.
  setTimeout(async () => {
    try {
      const b64 = process.env.SCHOOLS_IMPORT_B64;
      if (!b64) return;
      const text = Buffer.from(b64, 'base64').toString('utf8');
      let hash = 0; for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
      const guard = 'schools_import_' + hash.toString(16);
      if (await q.one(db.settings, { key: guard })) return;
      await q.insert(db.settings, { key: guard, value: true, at: nowISO() });
      let pridane = 0, dup = 0;
      for (const r of parseRows(text)) {
        if (await q.one(db.schools, { email: r.email })) { dup++; continue; }
        await q.insert(db.schools, { ...r, status: 'new', unsubscribed: false, mail_log_id: null,
          sent_at: null, note: '', created_at: nowISO(), updated_at: nowISO() });
        pridane++;
      }
      console.log('🎓 Školy — import z env: pridaných ' + pridane + ', duplicít ' + dup);
    } catch (e) { console.error('schools env import:', e.message); }
  }, 30 * 1000);

  // ── Ručná úprava (stav po telefonáte, poznámka, oprava adresy) ──────────────
  const STAVY = ['new', 'sent', 'replied', 'meeting', 'won', 'lost'];
  app.post('/api/admin/schools/:id', adminAuth, async (req, res) => {
    try {
      const s = await q.one(db.schools, { _id: req.params.id });
      if (!s) return res.status(404).json({ error: 'Škola nenájdená' });
      const set = { updated_at: nowISO() };
      for (const k of ['name', 'city', 'director', 'phone', 'note'])
        if (req.body[k] !== undefined) set[k] = String(req.body[k] || '').slice(0, 200);
      if (req.body.email !== undefined) set.email = String(req.body.email || '').toLowerCase().trim();
      if (req.body.status && STAVY.includes(req.body.status)) set.status = req.body.status;
      await q.update(db.schools, { _id: s._id }, { $set: set });
      res.json({ ok: true, school: await q.one(db.schools, { _id: s._id }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/admin/schools/:id', adminAuth, async (req, res) => {
    try { await q.remove(db.schools, { _id: req.params.id }); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Prefill pre landing (verejné, CORS — web beží na inej doméne) ───────────
  const prefillCors = res => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  };
  app.options('/api/public/school-prefill/:sid', (req, res) => { prefillCors(res); res.sendStatus(204); });
  app.get('/api/public/school-prefill/:sid', async (req, res) => {
    prefillCors(res);
    try {
      const s = await q.one(db.schools, { _id: String(req.params.sid || '').slice(0, 40) });
      if (!s || s.unsubscribed) return res.status(404).json({ error: 'not_found' });
      res.json({ ok: true, school: s.name || '', city: s.city || '', name: s.director || '',
        email: s.email || '', phone: s.phone || '' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Odhlásenie (verejné, bez prihlásenia) ───────────────────────────────────
  app.get('/skoly/odhlasit/:id', async (req, res) => {
    try {
      const s = await q.one(db.schools, { _id: String(req.params.id).slice(0, 40) });
      if (s) await q.update(db.schools, { _id: s._id },
        { $set: { unsubscribed: true, status: 'lost', updated_at: nowISO() } });
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!doctype html><html lang="sk"><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1"><title>Odhlásené</title></head>
        <body style="font-family:system-ui,Arial,sans-serif;background:#12100a;color:#e8e2d4;
          display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px">
        <div style="max-width:460px;text-align:center">
          <div style="font-size:2.4rem">✅</div>
          <h1 style="font-size:1.2rem;margin:10px 0">Odhlásené</h1>
          <p style="color:#b9b3a6;line-height:1.6">Ďakujeme — na túto adresu už nič neposielame.
          Ak by ste sa niekedy chceli o venčeku pobaviť, sme na ${TEL}.</p>
        </div></body></html>`);
    } catch (e) { res.status(500).send('Chyba'); }
  });

  app.get('/admin/skoly', adminAuth, (req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'admin-skoly.html')));

  return { parseRows, subjectFor, htmlFor, lpUrl };
};
