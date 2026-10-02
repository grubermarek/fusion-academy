/**
 * Fusion Academy — FUSION X (partnerské zľavy pre členov), 2. 10. 2026
 *
 * Každé aktívne, uhradené MESAČNÉ členstvo (Bronze, Silver, Gold, Online, deti na
 * bežných plánoch) otvára Fusion X: 10 % zľava na všetky produkty a služby partnerov.
 * Vstupy a permanentky (type 'bundle') ani skúšobný týždeň zadarmo nárok nedávajú.
 *
 * Partneri sa NEREGISTRUJÚ a nemajú účet ani rozhranie:
 *   - prihlásia sa formulárom na webe (POST /api/public/fusion-x/partner) → žiadosť
 *     padne do admin Fusion X + mail a oznam správcovi; nič sa nezverejní samo,
 *   - správca po dohode žiadosť schváli, doplní verejný profil a tým ho zaradí,
 *   - verejný zoznam (GET /api/public/fusion-x/partneri) ukazuje len schválených.
 *
 * Uplatnenie: klientka ukáže v appke kartu (/fusion-x) s QR kódom platným 5 minút.
 * QR nesie len zašifrovaný token (AES-256-GCM, kľúč v settings `fusionx_kluc`),
 * žiadne osobné údaje. Partner ho naskenuje fotoaparátom → /fx/<token> = overovacia
 * stránka bez prihlásenia: „Aktívne členstvo — nárok…" alebo „Nárok… nie je platný."
 * Nárok sa vždy počíta naživo z db.memberships, nie z tokenu.
 *
 * Sken je LEN overenie členstva, nie nákup — nikde neukazujeme „čerpanie" ani
 * „ušetrené €". V admine je počet overení, výslovne označený ako overenia členstva.
 */
'use strict';
const path = require('path');
const crypto = require('crypto');

module.exports = function initFusionX(ctx){
  const { app, db, q, Datastore, DATA_DIR, auth, adminAuth, nowISO, today, APP_URL, sendMail, emailTemplate,
    MEMBERSHIP_PLANS, naborCors, naborSpamDovody, klientIp, rlPublic, rateLimit, express, isTestContact } = ctx;

  db.fusionx_partneri = new Datastore({ filename: path.join(DATA_DIR, 'fusionx_partneri.db'), autoload: true });
  db.fusionx_overenia = new Datastore({ filename: path.join(DATA_DIR, 'fusionx_overenia.db'), autoload: true });
  db.fusionx_overenia.ensureIndex({ fieldName: 'kod' });

  const ZLAVA = 10;                       // % — rovnaká u všetkých partnerov
  const KOD_SEKUND = 5 * 60;              // platnosť QR kódu
  const APP = String(APP_URL || '').replace(/\/$/, '');
  const MAILY = ['gruber.marek@gmail.com', 'beatabunova22@gmail.com'];
  const KATEGORIE = ['Krása a starostlivosť', 'Zdravie a pohyb', 'Móda a doplnky', 'Jedlo a kaviarne',
    'Služby', 'Deti a rodina', 'Obchod', 'Iné'];
  const STAVY = { novy: 'Nová žiadosť', v_rieseni: 'V riešení', schvaleny: 'Schválený — zverejnený',
    pozastaveny: 'Pozastavený', zamietnuty: 'Zamietnutý' };
  // Mesačné plány = všetko okrem vstupov a permanentiek
  const MESACNE = new Set(Object.entries(MEMBERSHIP_PLANS).filter(([, p]) => p.type !== 'bundle').map(([k]) => k));

  const txt = (v, n) => String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, n || 300);
  const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const webUrl = v => { const s = txt(v, 200); if (!s) return ''; return /^https?:\/\//i.test(s) ? s : 'https://' + s.replace(/^\/+/, ''); };
  const datumSk = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear(); };
  const kratkeMeno = n => { const p = String(n || '').trim().split(/\s+/).filter(Boolean); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : (p[0] || 'Člen'); };

  // ── Nárok ──────────────────────────────────────────────────────────────────
  // Uhradené = nie skúšobný týždeň zadarmo (trial bez trial_from) a nie nulová cena.
  // Bronze→Silver „mesiac na skúšku" (trial_from) je zaplatené Bronze, takže platí.
  // Glofox členstvá nemajú cenu, ale boli zaplatené v Glofoxe — platia.
  const uhradene = m => !(m.trial && !m.trial_from) && !(m.price !== undefined && m.price !== null && +m.price === 0 && !m.glofox && !m.migrated);
  async function narok(userId){
    if (!userId) return { aktivny: false };
    const teraz = new Date();
    const platne = (await q.find(db.memberships, { user_id: userId, status: 'active' }))
      .filter(m => !m._type && MESACNE.has(m.plan_id) && m.expires_at && new Date(m.expires_at) >= teraz && uhradene(m))
      .sort((a, b) => String(b.expires_at).localeCompare(String(a.expires_at)));
    if (!platne.length) return { aktivny: false };
    return { aktivny: true, platne_do: platne[0].expires_at, plan: platne[0].plan_name || MEMBERSHIP_PLANS[platne[0].plan_id]?.name || 'Členstvo' };
  }
  const verejnyPartner = p => p.stav === 'schvaleny' && !p.spam;
  const pocetPartnerov = async () => (await q.find(db.fusionx_partneri, { stav: 'schvaleny' })).filter(verejnyPartner).length;

  // Stav pre /api/me a nástenku
  async function stav(u){
    if (!u) return null;
    const n = await narok(u._id);
    return { ...n, zlava: ZLAVA, partneri: await pocetPartnerov() };
  }

  // Oznam „Fusion X máš otvorený!" — raz za každé obdobie nároku (nová aktivácia po
  // výpadku áno, obnova nadväzujúca na bežiace členstvo nie). Kým nie je zverejnený ani
  // jeden partner, oznam čaká — inak by sme posielali na prázdny zoznam; po schválení
  // prvého partnera ho dostanú všetci aktívni pri najbližšom otvorení appky.
  async function oznamAktivacie(userId){
    try {
      const u = await q.one(db.users, { _id: userId });
      if (!u || u.is_child) return;
      const n = await narok(userId);
      if (!n.aktivny) return;
      const dnes = today();
      const bezal = u.fusionx_do && String(u.fusionx_do).slice(0, 10) >= dnes;
      if (!bezal) {
        if (!(await pocetPartnerov())) return;
        await q.insert(db.notifications, { user_id: userId, type: 'fusion_x',
          title: 'Fusion X máš otvorený! 🎉',
          body: 'Objav partnerov a využívaj svoje ' + ZLAVA + ' % zľavy.',
          link: '/fusion-x', read: false, created_at: nowISO() }).catch(() => {});
      }
      if (String(u.fusionx_do || '') !== String(n.platne_do)) await q.update(db.users, { _id: userId }, { $set: { fusionx_do: n.platne_do } });
    } catch (e) { console.error('Fusion X oznam:', e.message); }
  }

  // ── Token v QR (bez osobných údajov) ───────────────────────────────────────
  let KLUC = null;
  async function kluc(){
    if (KLUC) return KLUC;
    let s = await q.one(db.settings, { key: 'fusionx_kluc' });
    if (!s || !/^[0-9a-f]{64}$/.test(String(s.value || ''))) {
      const v = crypto.randomBytes(32).toString('hex');
      if (s) await q.update(db.settings, { _id: s._id }, { $set: { value: v } });
      else await q.insert(db.settings, { key: 'fusionx_kluc', value: v, created_at: nowISO() });
      s = { value: v };
    }
    KLUC = Buffer.from(s.value, 'hex');
    return KLUC;
  }
  async function zabal(uid, exp){
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', await kluc(), iv);
    const t = Buffer.alloc(4); t.writeUInt32BE(exp >>> 0);
    const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(String(uid), 'utf8'), t])), c.final()]);
    return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64url');
  }
  async function rozbal(tok){
    try {
      const b = Buffer.from(String(tok || ''), 'base64url');
      if (b.length < 12 + 5 + 16 || b.length > 120) return null;
      const d = crypto.createDecipheriv('aes-256-gcm', await kluc(), b.subarray(0, 12));
      d.setAuthTag(b.subarray(b.length - 16));
      const pt = Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]);
      return { uid: pt.subarray(0, pt.length - 4).toString('utf8'), exp: pt.readUInt32BE(pt.length - 4) };
    } catch (e) { return null; }
  }

  // ── Klientka: stav, karta, partneri ────────────────────────────────────────
  app.get('/api/fusion-x/stav', auth, async (req, res) => {
    try {
      const u = await q.one(db.users, { _id: req.session.uid });
      if (!u) return res.status(404).json({ error: 'Účet sa nenašiel.' });
      res.json({ ...(await stav(u)), meno: u.name || '' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Nový krátkodobý QR. Bez nároku sa kód nevydá — karta ukáže, že nárok nie je platný.
  app.post('/api/fusion-x/kod', auth, async (req, res) => {
    try {
      const u = await q.one(db.users, { _id: req.session.uid });
      if (!u) return res.status(404).json({ error: 'Účet sa nenašiel.' });
      const n = await narok(u._id);
      if (!n.aktivny) return res.status(403).json({ error: 'Fusion X je súčasťou mesačného členstva. Aktivuj si členstvo a získaš prístup k partnerským zľavám.', aktivny: false });
      const exp = Math.floor(Date.now() / 1000) + KOD_SEKUND;
      const url = APP + '/fx/' + await zabal(u._id, exp);
      const qr = await require('qrcode').toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
      res.json({ ok: true, url, qr, plati_do: new Date(exp * 1000).toISOString(), sekund: KOD_SEKUND, meno: u.name || '', ...n });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  function verejnyProfil(p){
    const f = p.profil || {};
    return { id: p._id, nazov: f.nazov || p.firma, mesto: f.mesto || p.mesto, kategoria: f.kategoria || p.kategoria,
      popis: f.popis || '', uplatnenie: f.uplatnenie || '', adresa: f.adresa || '', telefon: f.telefon || '',
      web: f.web || '', logo: f.logo || '', zlava: ZLAVA, poradie: +f.poradie || 0 };
  }
  async function verejniPartneri(){
    return (await q.find(db.fusionx_partneri, { stav: 'schvaleny' })).filter(verejnyPartner).map(verejnyProfil)
      .sort((a, b) => (a.poradie - b.poradie) || String(a.mesto).localeCompare(String(b.mesto), 'sk') || String(a.nazov).localeCompare(String(b.nazov), 'sk'));
  }
  app.get('/api/fusion-x/partneri', auth, async (req, res) => {
    try { res.json({ partneri: await verejniPartneri(), zlava: ZLAVA }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Pre web (iná doména) — len schválení a len verejný profil, žiadne kontakty zo žiadosti.
  app.get('/api/public/fusion-x/partneri', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=300');
    try { res.json({ partneri: await verejniPartneri(), zlava: ZLAVA, kategorie: KATEGORIE }); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Overovacia stránka pre partnera (bez prihlásenia) ─────────────────────
  const rlFx = rateLimit ? rateLimit({ max: 120, windowMs: 10 * 60 * 1000, message: 'Priveľa overení. Skúste o chvíľu.' }) : (req, res, next) => next();
  function overStranka(ok, meno, dovod){
    const farba = ok ? '#22c55e' : '#ef4444';
    const ikona = ok
      ? '<svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
      : '<svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    return `<!doctype html><html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Overenie Fusion X</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#0d0b07;color:#f3ede0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;padding:20px}
.k{width:100%;max-width:420px;background:#17140d;border:1px solid #3a3220;border-radius:22px;padding:28px 22px;text-align:center}
.brand{display:flex;align-items:center;justify-content:center;gap:10px;font-weight:800;letter-spacing:.14em;font-size:.8rem;color:#C9A84C;margin-bottom:22px}
.brand img{width:30px;height:30px}
.kruh{width:108px;height:108px;border-radius:50%;background:${farba};display:flex;align-items:center;justify-content:center;margin:0 auto 18px;box-shadow:0 0 0 10px ${farba}22}
h1{font-size:1.35rem;line-height:1.35;margin:0 0 10px}
.meno{font-size:1.15rem;font-weight:700;color:#C9A84C;margin:6px 0 2px}
.mut{color:#a59d8a;font-size:.9rem;line-height:1.5}
.cas{margin-top:18px;padding-top:16px;border-top:1px solid #2e2818;font-variant-numeric:tabular-nums;color:#a59d8a;font-size:.85rem}
.cas b{color:#f3ede0;font-size:1.05rem}
</style></head><body><main class="k">
<div class="brand"><img src="/logo-mark.png" alt="">FUSION X</div>
<div class="kruh">${ikona}</div>
${ok
  ? `<h1>Aktívne členstvo — nárok na zľavu Fusion X ${ZLAVA} %.</h1><div class="meno">${escH(meno)}</div><p class="mut">Člen Fusion Academy. Zľavu poskytnite vo svojom bežnom predajnom procese.</p>`
  : `<h1>Nárok na zľavu nie je platný.</h1><p class="mut">${escH(dovod || '')}</p>`}
<div class="cas">Overené <b id="t"></b></div>
</main><script>(function(){var t=document.getElementById('t');function f(){var d=new Date();t.textContent=d.getDate()+'. '+(d.getMonth()+1)+'. '+d.getFullYear()+' '+d.toLocaleTimeString('sk-SK');}f();setInterval(f,1000);})();</script>
</body></html>`;
  }
  app.get('/fx/:kod', rlFx, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const kod = String(req.params.kod || '').slice(0, 200);
    const hash = crypto.createHash('sha256').update(kod).digest('hex').slice(0, 32);
    let vysledok = 'neplatny', ok = false, meno = '', dovod = 'Kód sa nedá overiť. Požiadajte člena, aby v aplikácii otvoril kartu Fusion X znova.', uid = null;
    try {
      const t = await rozbal(kod);
      if (t) {
        uid = t.uid;
        if (t.exp < Math.floor(Date.now() / 1000)) { vysledok = 'vyprsany'; dovod = 'Platnosť QR kódu vypršala. Požiadajte člena, aby v aplikácii otvoril kartu Fusion X znova.'; }
        else {
          const u = await q.one(db.users, { _id: t.uid });
          const n = u ? await narok(u._id) : { aktivny: false };
          if (u && n.aktivny) { ok = true; vysledok = 'platny'; meno = kratkeMeno(u.name); }
          else { vysledok = 'bez_naroku'; dovod = 'Člen momentálne nemá aktívne mesačné členstvo.'; }
        }
      }
      // Počítame overenia, nie nákupy. Jeden QR kód = jedno overenie (obnovenie stránky sa nepripočíta).
      if (uid && !(await q.one(db.fusionx_overenia, { kod: hash })))
        await q.insert(db.fusionx_overenia, { kod: hash, user_id: uid, vysledok, at: nowISO(), den: today() });
    } catch (e) { console.error('Fusion X overenie:', e.message); }
    res.type('html').send(overStranka(ok, meno, dovod));
  });

  // ── Žiadosť partnera z webu ────────────────────────────────────────────────
  app.options('/api/public/fusion-x/partner', (req, res) => { naborCors(req, res); res.sendStatus(204); });
  app.post('/api/public/fusion-x/partner', rlPublic, express.urlencoded({ extended: false, limit: '12kb' }), async (req, res) => {
    naborCors(req, res);
    try {
      const b = req.body || {};
      const firma = txt(b.firma, 120), mesto = txt(b.mesto, 80), kategoria = txt(b.kategoria, 60);
      const kontakt_meno = txt(b.kontakt, 120), email = txt(b.email, 160).toLowerCase(), telefon = txt(b.telefon, 40);
      const web = txt(b.web, 200), opis = txt(b.opis, 1200);
      const ano = v => ['1', 'true', 'on', 'ano', 'áno'].includes(String(v || '').toLowerCase()) || v === true;
      if (!firma) return res.status(400).json({ error: 'Napíšte názov firmy.', pole: 'firma' });
      if (!mesto) return res.status(400).json({ error: 'Napíšte mesto.', pole: 'mesto' });
      if (!kategoria) return res.status(400).json({ error: 'Vyberte kategóriu služieb.', pole: 'kategoria' });
      if (!kontakt_meno) return res.status(400).json({ error: 'Napíšte meno kontaktnej osoby.', pole: 'kontakt' });
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Skontrolujte e-mail.', pole: 'email' });
      if (telefon.replace(/\D/g, '').length < 9) return res.status(400).json({ error: 'Skontrolujte telefón.', pole: 'telefon' });
      if (!opis) return res.status(400).json({ error: 'Opíšte stručne, čo ponúkate.', pole: 'opis' });
      if (!ano(b.zlava)) return res.status(400).json({ error: 'Partnerom sa môže stať firma, ktorá dá členom ' + ZLAVA + ' % zľavu na všetky produkty a služby.', pole: 'zlava' });
      if (!ano(b.consent)) return res.status(400).json({ error: 'Bez súhlasu so spracovaním údajov žiadosť neprijmeme.', pole: 'consent' });
      const dovody = naborSpamDovody({ name: kontakt_meno, city: mesto, email, phone: telefon, motivation: opis, social: web, honeypot: txt(b.website, 100), ms: parseInt(b.ms, 10) });
      const spam = dovody.length > 0;
      const z = await q.insert(db.fusionx_partneri, {
        firma, mesto, kategoria, kontakt_meno, email, telefon, web: web ? webUrl(web) : '', opis,
        suhlas_zlava: true, suhlas_udaje: true, stav: spam ? 'zamietnuty' : 'novy', zdroj: 'web',
        spam: spam || undefined, spam_dovody: spam ? dovody : undefined,
        profil: { nazov: firma, mesto, kategoria, popis: '', uplatnenie: '', adresa: '', telefon: '', web: web ? webUrl(web) : '', logo: '', poradie: 0 },
        ip: klientIp(req) || null, ua: String(req.headers['user-agent'] || '').slice(0, 300),
        utm: txt(b.utm, 300), page: txt(b.page, 200), created_at: nowISO()
      });
      if (!spam && !isTestContact(email)) {
        const r = (k, v) => v ? `<tr><td style="color:#999;padding:4px 12px 4px 0;vertical-align:top">${k}</td><td style="padding:4px 0">${v}</td></tr>` : '';
        const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#0a0a0a;color:#eee;padding:20px">
          <h2 style="color:#C9A84C;margin:0 0 12px">🤝 Nová žiadosť o partnerstvo Fusion X</h2>
          <table style="font-size:14px;border-collapse:collapse">
            ${r('Firma', '<b>' + escH(firma) + '</b>')}${r('Mesto', escH(mesto))}${r('Kategória', escH(kategoria))}
            ${r('Kontakt', escH(kontakt_meno))}${r('E-mail', escH(email))}
            ${r('Telefón', `<a href="tel:${escH(telefon)}" style="color:#C9A84C">${escH(telefon)}</a>`)}
            ${r('Web / siete', escH(web))}${r('Ponuka', escH(opis).replace(/\n/g, '<br>'))}
            ${r('Zľava', 'súhlasí s ' + ZLAVA + ' % na všetky produkty a služby')}
          </table>
          <p style="color:#888;font-size:12px;margin-top:16px">Partner sa nezverejní sám. Po dohode ho schváľ v admine: Fusion X → Žiadosti.</p>
          <p><a href="${APP}/admin" style="color:#C9A84C">Otvoriť admin</a></p></body></html>`;
        for (const to of MAILY) { try { await sendMail(to, '🤝 Fusion X — žiadosť: ' + firma + ' (' + mesto + ')', html); } catch (e) { } }
        for (const a of await q.find(db.users, { is_admin: true })) {
          await q.insert(db.notifications, { user_id: a._id, type: 'fusion_x_ziadost', title: '🤝 Nová žiadosť o partnerstvo Fusion X',
            body: firma + ' · ' + mesto + ' · ' + kategoria, link: '/admin', read: false, created_at: nowISO() }).catch(() => { });
        }
      }
      res.json({ ok: true, id: z._id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Admin ──────────────────────────────────────────────────────────────────
  async function statistikaOvereni(){
    const vsetky = await q.find(db.fusionx_overenia, {});
    const od30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const platne = vsetky.filter(o => o.vysledok === 'platny');
    return {
      spolu: vsetky.length, platne: platne.length, neplatne: vsetky.length - platne.length,
      za_30_dni: vsetky.filter(o => (o.den || '') >= od30).length,
      clenov: new Set(platne.map(o => o.user_id)).size,
      posledne: vsetky.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 1).map(o => o.at)[0] || null
    };
  }
  app.get('/api/admin/fusion-x', adminAuth, async (req, res) => {
    try {
      const vsetci = (await q.find(db.fusionx_partneri, {})).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      res.json({ partneri: vsetci, stavy: STAVY, kategorie: KATEGORIE, zlava: ZLAVA, overenia: await statistikaOvereni() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  function profilZBody(b, stary){
    const f = { ...(stary || {}) };
    for (const [k, n] of [['nazov', 120], ['mesto', 80], ['kategoria', 60], ['popis', 600], ['uplatnenie', 300], ['adresa', 200], ['telefon', 40]])
      if (b[k] !== undefined) f[k] = txt(b[k], n);
    if (b.web !== undefined) f.web = b.web ? webUrl(b.web) : '';
    if (b.logo !== undefined) { const l = txt(b.logo, 400); f.logo = /^(https:\/\/|\/)/i.test(l) ? l : ''; }
    if (b.poradie !== undefined) f.poradie = Math.max(-999, Math.min(999, parseInt(b.poradie, 10) || 0));
    return f;
  }
  app.post('/api/admin/fusion-x/partneri', adminAuth, async (req, res) => {
    try {
      const b = req.body || {};
      const firma = txt(b.firma, 120);
      if (!firma) return res.status(400).json({ error: 'Chýba názov firmy.' });
      const z = await q.insert(db.fusionx_partneri, {
        firma, mesto: txt(b.mesto, 80), kategoria: txt(b.kategoria, 60), kontakt_meno: txt(b.kontakt_meno, 120),
        email: txt(b.email, 160).toLowerCase(), telefon: txt(b.telefon, 40), web: b.web ? webUrl(b.web) : '', opis: txt(b.opis, 1200),
        suhlas_zlava: true, stav: 'v_rieseni', zdroj: 'admin', pridal: req.session.uid,
        profil: profilZBody({ nazov: firma, mesto: b.mesto, kategoria: b.kategoria, web: b.web, ...(b.profil || {}) }, {}),
        created_at: nowISO()
      });
      res.json({ ok: true, id: z._id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/admin/fusion-x/partneri/:id', adminAuth, async (req, res) => {
    try {
      const p = await q.one(db.fusionx_partneri, { _id: String(req.params.id) });
      if (!p) return res.status(404).json({ error: 'Partner sa nenašiel.' });
      const b = req.body || {}, set = { updated_at: nowISO() };
      if (b.stav !== undefined) {
        if (!STAVY[b.stav]) return res.status(400).json({ error: 'Neznámy stav.' });
        set.stav = b.stav;
        if (b.stav === 'schvaleny') {
          const f = profilZBody(b.profil || {}, p.profil);
          if (!f.nazov || !f.mesto) return res.status(400).json({ error: 'Pred zverejnením doplň v profile aspoň názov a mesto.' });
          if (!p.schvaleny_at) set.schvaleny_at = nowISO();
          set.spam = false;
        }
      }
      if (b.profil) set.profil = profilZBody(b.profil, p.profil);
      if (b.poznamka !== undefined) set.poznamka = txt(b.poznamka, 1000);
      for (const [k, n] of [['kontakt_meno', 120], ['telefon', 40], ['email', 160]]) if (b[k] !== undefined) set[k] = txt(b[k], n);
      await q.update(db.fusionx_partneri, { _id: p._id }, { $set: set });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.delete('/api/admin/fusion-x/partneri/:id', adminAuth, async (req, res) => {
    try {
      const p = await q.one(db.fusionx_partneri, { _id: String(req.params.id) });
      if (!p) return res.status(404).json({ error: 'Partner sa nenašiel.' });
      if (p.stav === 'schvaleny') return res.status(400).json({ error: 'Zverejneného partnera najprv pozastav.' });
      await q.remove(db.fusionx_partneri, { _id: p._id });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/fusion-x', (req, res) => res.sendFile(path.join(__dirname, 'public', 'fusion-x.html')));

  return { narok, stav, oznamAktivacie, ZLAVA };
};
