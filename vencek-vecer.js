/**
 * Venčekový večer — príprava a riadenie programu naživo (Marek 22. 9. 2026).
 *
 * „Jedna časť bude príprava na venčekový večer a druhá itinerár aj s timerom,
 * programom a scenárom. Postupne sa bude preklikávať od prvého po posledný bod
 * a celému tímu to bude cinkať, aby vedeli, čo nasleduje. Každý bude mať v
 * telefóne otvorené, kto je súčasťou tímu a čo sa ide diať."
 *
 * Jeden záznam = jeden večer jednej venčekovej skupiny (db.vencek_vecery):
 *   team    — ľudia a roly (DJ, fotograf, moderátor, kvety, diplomy…) + či sú dohodnutí
 *   items   — nákupný zoznam, úlohy na prípravu a čo zbaliť (stav nemáme / časť / máme)
 *   program — body večera s trvaním, zodpovednými, scenárom a hudbou
 *   live    — kde sa večer práve nachádza (bod, kedy začal, pauza, správa tímu)
 *
 * Prístup: admin cez prihlásenie; každý člen tímu má vlastný tajný odkaz
 * /vecer/<token> bez účtu (DJ ani fotograf v appke účet nemajú). Program môže
 * posúvať admin a člen tímu s právom riadiť (moderátor). Zmeny sa rozosielajú
 * cez Socket.io menný priestor /vecer — stránka pri zmene bodu zacinká.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QR = require('qrcode');
let webpush = null;
try{ webpush = require('web-push'); }catch(e){ console.warn('✨ Venčekový večer: web-push nie je nainštalovaný — push notifikácie nepôjdu'); }

module.exports = function mountVencekVecer(ctx){
  const { app, io, db, q, Datastore, DATA_DIR, adminAuth, nowISO, today, APP_URL, sendMail, emailTemplate } = ctx;

  db.vencek_vecery = new Datastore({ filename: path.join(DATA_DIR, 'vencek_vecery.db'), autoload: true });
  db.vencek_vecery.ensureIndex({ fieldName: 'class_id' });
  // Push odbery telefónov tímu (zamknutý telefón nevie zacinkať zo stránky).
  db.vencek_vecer_push = new Datastore({ filename: path.join(DATA_DIR, 'vencek_vecer_push.db'), autoload: true });
  db.vencek_vecer_push.ensureIndex({ fieldName: 'endpoint', unique: true });

  const nid = () => crypto.randomBytes(5).toString('hex');
  const token = () => crypto.randomBytes(12).toString('base64url');
  const txt = (s, n) => String(s == null ? '' : s).replace(/[<>]/g, '').trim().slice(0, n || 120);
  const cislo = (v, min, max) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null; };
  const suma = v => { const n = +String(v == null ? '' : v).replace(',', '.'); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };
  const hhmm = v => { const m = String(v || '').trim().match(/^(\d{1,2})[:.](\d{2})$/); if(!m) return ''; const h = +m[1], mi = +m[2]; return h < 24 && mi < 60 ? String(h).padStart(2, '0') + ':' + m[2] : ''; };

  // ── Roly a stavy ────────────────────────────────────────────────────────────
  const ROLY = {
    lektor:    { ic: '💃', t: 'Tanečný majster' },
    moderator: { ic: '🎤', t: 'Moderátor' },
    dj:        { ic: '🎵', t: 'DJ / ozvučenie' },
    foto:      { ic: '📸', t: 'Fotograf' },
    kamera:    { ic: '🎥', t: 'Kameraman' },
    kvety:     { ic: '💐', t: 'Kvety' },
    diplomy:   { ic: '📜', t: 'Diplomy' },
    skola:     { ic: '🏫', t: 'Škola' },
    sala:      { ic: '🏛️', t: 'Sála' },
    pomoc:     { ic: '🙋', t: 'Pomocník' },
  };
  const DOHODA = ['hladame', 'oslovene', 'dohodnute'];
  const STAV = ['nie', 'pol', 'ok'];
  const KAT = ['nakup', 'priprava', 'zbalit'];

  // ── Šablóna novej prípravy ─────────────────────────────────────────────────
  // Je to NÁVRH na úpravu — konkrétny program sa dohaduje so školou. Počty kusov
  // sa rátajú zo skutočného počtu žiakov skupiny, ostatné necháva prázdne.
  function sablona(c, pocetZiakov){
    const n = pocetZiakov > 0 ? pocetZiakov : null;
    const clen = (role, extra) => ({ id: nid(), role, role_label: ROLY[role].t, name: '', phone: '',
      dohoda: 'hladame', price: null, zaloha: false, note: '', can_control: false, token: token(), ...extra });
    const team = [
      clen('lektor', { name: c.lecturer || '', dohoda: c.lecturer ? 'dohodnute' : 'hladame', can_control: true }),
      clen('moderator', { can_control: true, note: 'Uvádza program a číta mená pri nástupe a diplomoch.' }),
      clen('dj', { note: 'Ozvučenie aj mikrofón pre moderátora. Playlist ku každému tancu.' }),
      clen('foto'),
      clen('kamera', { note: 'Voliteľné — aftermovie z večera.' }),
      clen('kvety'),
      clen('diplomy'),
      clen('skola', { note: 'Kontakt na školu (riaditeľ/ka, triedna).' }),
    ];
    const kto = (...roly) => roly.map(r => (team.find(t => t.role === r) || {}).id).filter(Boolean);
    const polozka = (cat, name, qty, unit, note) => ({ id: nid(), cat, name, qty: qty || null, have: 0,
      unit: unit || (qty ? 'ks' : ''), stav: 'nie', who: '', price: null, note: note || '', updated_by: '', updated_at: '' });
    // Počet = počet žiakov skupiny a mení sa sám, ako pribúdajú registrácie.
    const naZiaka = name => ({ ...polozka('nakup', name, n, 'ks'), na_ziaka: true });
    const items = [
      naZiaka('Kvety pre rodičov (žiaci ich darujú rodičom)'),
      polozka('nakup', 'Kytice pre triednu učiteľku a vedenie školy', 2, 'ks'),
      naZiaka('Pierka pre chlapcov a kvietky pre dievčatá'),
      naZiaka('Papier na diplomy'),
      naZiaka('Obaly / dosky na diplomy'),
      polozka('nakup', 'Výzdoba sály (balóny, stuhy)', null, ''),
      polozka('nakup', 'Voda a občerstvenie pre žiakov a tím', null, ''),
      polozka('nakup', 'Darček pre triednu učiteľku', 1, 'ks'),
      polozka('priprava', 'Potvrdiť sálu a čas, kedy môžeme chystať'),
      polozka('priprava', 'Dohodnúť DJ-a a ozvučenie (aj mikrofón)'),
      polozka('priprava', 'Dohodnúť fotografa'),
      polozka('priprava', 'Dohodnúť moderátora'),
      polozka('priprava', 'Poradie párov na nástup (mená na čítanie)'),
      polozka('priprava', 'Vytlačiť diplomy s menami'),
      polozka('priprava', 'Poslať DJ-ovi playlist ku každému tancu'),
      polozka('priprava', 'Generálka nástupu priamo v sále'),
      polozka('priprava', 'Pozvánky pre rodičov a počet hostí'),
      polozka('priprava', 'Stoly a zasadací poriadok'),
      polozka('priprava', 'Pokyny žiakom: oblečenie a čas príchodu'),
      polozka('zbalit', 'Diplomy zoradené podľa poradia odovzdávania'),
      polozka('zbalit', 'Kvety, pierka a kvietky'),
      polozka('zbalit', 'Vytlačený scenár a zoznam mien'),
      polozka('zbalit', 'Predlžovačka, batérie do mikrofónu'),
      polozka('zbalit', 'Nožnice, lepiaca páska, zatváracie špendlíky'),
      polozka('zbalit', 'Nabíjačka / powerbanka'),
    ];
    // Tance: ak skupina už nejaké vie (úroveň > 0), každý dostane vlastný bod.
    // Inak jeden spoločný bod, ktorý sa upresní, keď bude jasné, čo sa predvedie.
    const vie = (Array.isArray(c.dances) ? c.dances : []).filter(d => (+d.level || 0) > 0).map(d => d.name);
    const bod = (title, dur, who, script, music, pary) => ({ id: nid(), at: '', dur, title, who, script: script || '', music: music || '', note: '', ukaz_pary: !!pary });
    const tance = vie.length && vie.length <= 8
      ? vie.map(t => bod('Tanec: ' + t, 4, kto('dj', 'moderator', 'foto', 'kamera'), 'Moderátor uvedie tanec, páry sú na parkete.', 'Skladba na ' + t))
      : [bod('Predvedenie naučených tancov', 20, kto('dj', 'moderator', 'foto', 'kamera', 'lektor'),
          'Ktoré tance sa predvedú a v akom poradí — doplniť podľa toho, čo skupina zvládne.', 'Skladby podľa playlistu')];
    const program = [
      bod('Príchod hostí a usadenie', 30, kto('moderator', 'dj', 'foto'),
        'Hudba do pozadia, rodičia sa usádzajú. Žiaci sa chystajú v zázemí na nástup.', 'Hudba do pozadia'),
      bod('Slávnostný nástup párov', 10, kto('moderator', 'dj', 'foto', 'kamera', 'lektor'),
        'Moderátor privíta hostí a číta mená párov, páry prichádzajú po jednom.', 'Nástupová skladba', true),
      bod('Otvorenie a príhovory', 10, kto('moderator', 'skola', 'lektor'),
        'Privítanie, príhovor vedenia školy a tanečného majstra.', 'Hudba stíšená'),
      bod('Polonéza — otvorenie večera', 5, kto('dj', 'lektor', 'foto', 'kamera'), '', 'Polonéza'),
      ...tance,
      bod('Odovzdanie diplomov', 15, kto('diplomy', 'moderator', 'foto', 'lektor', 'skola'),
        'Moderátor číta mená, žiak si prevezme diplom, krátka fotka.', 'Hudba do pozadia', true),
      bod('Poďakovanie rodičom — kvety a tanec s rodičmi', 10, kto('kvety', 'dj', 'moderator', 'foto', 'kamera'),
        'Žiaci darujú rodičom kvet a vyzvú ich do tanca.', 'Valčík'),
      bod('Spoločná fotografia', 10, kto('foto', 'lektor'), 'Všetci absolventi spolu s tanečným majstrom a učiteľmi.'),
      bod('Prípitok a občerstvenie', 45, kto('moderator', 'dj'), '', 'Hudba do pozadia'),
      bod('Voľná zábava', 60, kto('dj', 'foto'), '', 'Tanečný playlist'),
      bod('Záverečný tanec a rozlúčka', 10, kto('dj', 'moderator', 'lektor'), 'Poďakovanie všetkým, posledný spoločný tanec.', 'Záverečná skladba'),
    ];
    const diplom = { nadpis: 'Diplom', text: 'za úspešné absolvovanie tanečného kurzu',
      podpis1: c.lecturer || '', podpis1_rola: 'tanečný majster', podpis2: '', podpis2_rola: 'riaditeľ/ka školy' };
    return { team, items, program, diplom };
  }

  // ── Plánované časy bodov ───────────────────────────────────────────────────
  // Bod s pevným časom (at) začína vtedy; ostatné nadväzujú na koniec predošlého.
  function naMin(s){ const m = String(s || '').match(/^(\d{2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; }
  function zMin(n){ n = ((n % 1440) + 1440) % 1440; return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); }
  function planCasy(v){
    let kurzor = naMin(v.start_time);
    return (v.program || []).map(p => {
      const pevny = naMin(p.at);
      const zac = pevny != null ? pevny : kurzor;
      kurzor = zac != null ? zac + (+p.dur || 0) : null;
      return zac != null ? zMin(zac) : null;
    });
  }

  // ── Prístup ────────────────────────────────────────────────────────────────
  // Večerov bude niekoľko, takže hľadanie tokenu v pamäti je rýchle a nezávisí
  // od toho, ako NeDB porovnáva polia vnorených dokumentov.
  async function pristup({ t, id, uid }){
    t = String(t || ''); id = String(id || '');
    if(t && t.length >= 12){
      for(const v of await q.find(db.vencek_vecery, {})){
        const m = (v.team || []).find(x => x.token === t);
        if(m) return { v, me: m, admin: false, control: !!m.can_control };
        if(v.view_token === t) return { v, me: null, admin: false, control: false };
      }
      return null;
    }
    if(id && uid){
      const u = await q.one(db.users, { _id: uid });
      if(u && u.is_admin){
        const v = await q.one(db.vencek_vecery, { _id: id });
        if(v) return { v, me: null, admin: true, control: true, user: u };
      }
    }
    return null;
  }

  async function skupina(v){
    const c = await q.one(db.venceky_classes, { _id: v.class_id });
    const s = c ? await q.one(db.venceky_schools, { _id: c.school_id }) : null;
    return { c, s };
  }

  const odkaz = t => APP_URL + '/vecer/' + t;

  // Žiaci skupiny (na počty kusov, páry a diplomy). Mená detí idú len tomu,
  // kto ich na večere naozaj potrebuje — moderátor číta, baby chystajú diplomy.
  async function ziaciSkupiny(classId){
    return (await q.find(db.users, { venceky_class_id: classId }))
      .filter(u => (u.venceky_role || 'student') === 'student' && u.active !== false)
      .map(u => ({ id: u._id, name: String(u.name || '').replace(/\s+/g, ' ').trim() }))
      .sort((a, b) => a.name.localeCompare(b.name, 'sk'));
  }
  // Jedno dieťa = jedno meno. V Halíči (22. 9.) mali traja žiaci po dvoch účtoch
  // (rodič sa zaregistroval ako žiak s menom dieťaťa) — kvety a diplomy by sa
  // inak kupovali a tlačili dvakrát.
  const klucMena = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  function deti(ziaci){
    const m = new Map();
    for(const z of ziaci){ const k = klucMena(z.name); if(!k) continue; if(m.has(k)) m.get(k).ucty++; else m.set(k, { ...z, ucty: 1 }); }
    return [...m.values()];
  }
  const vidiMena = acc => !!(acc.admin || acc.control || (acc.me && ['moderator', 'diplomy', 'lektor'].includes(acc.me.role)));
  function menaParov(v, ziaci){
    const podlaId = Object.fromEntries(ziaci.map(z => [z.id, z.name]));
    const meno = o => o ? (o.uid ? (podlaId[o.uid] || o.name || '') : (o.name || '')) : '';
    return (v.pary || []).map(p => ({ id: p.id, a: meno(p.a), b: meno(p.b), a_uid: (p.a || {}).uid || '', b_uid: (p.b || {}).uid || '' }));
  }
  // Položka „na žiaka" má počet podľa aktuálneho počtu žiakov skupiny.
  function obnovPocet(it, pocet){
    if(!it.na_ziaka || !(pocet > 0) || it.qty === pocet) return it;
    it.qty = pocet;
    if(it.have > 0) it.stav = it.have >= pocet ? 'ok' : 'pol';
    return it;
  }

  async function pohlad(acc){
    const v = acc.v, { c, s } = await skupina(v);
    const casy = planCasy(v);
    const ucty = await ziaciSkupiny(v.class_id), ziaci = deti(ucty);
    const mena = vidiMena(acc);
    // Admin vidí, kto má zapnuté upozornenia na zamknutý telefón.
    const odbery = acc.admin ? await q.find(db.vencek_vecer_push, { vecer_id: v._id }) : [];
    const team = (v.team || []).map(m => ({
      id: m.id, role: m.role, role_label: m.role_label || (ROLY[m.role] || {}).t || 'Tím', ic: (ROLY[m.role] || ROLY.pomoc).ic,
      name: m.name, phone: m.phone, dohoda: m.dohoda, note: m.note, can_control: !!m.can_control,
      // Honorár DJ-a nemá vidieť fotograf — ceny a odkazy len adminovi.
      ...(acc.admin ? { price: m.price, zaloha: !!m.zaloha, token: m.token, link: odkaz(m.token), cost_id: m.cost_id || null,
        push: odbery.filter(s => s.member_id === m.id).length } : {}),
    }));
    return {
      ok: true, id: v._id, title: v.title, class_id: v.class_id,
      class_name: c ? c.name : '', class_code: c ? c.code : '', school: s ? s.name : '',
      event_date: c ? (c.event_date || '') : '', event_venue: c ? (c.event_venue || '') : '',
      start_time: v.start_time || '', warn_min: v.warn_min == null ? 2 : v.warn_min, notes: acc.admin ? (v.notes || '') : '',
      team, items: (v.items || []).map(it => obnovPocet({ ...it }, ziaci.length)),
      program: (v.program || []).map((p, i) => ({ ...p, plan: casy[i] })),
      live: v.live || { status: 'pred', idx: -1 }, rev: v.rev || 0,
      server_now: Date.now(), students: ziaci.length,
      me: acc.me ? { id: acc.me.id, role: acc.me.role, name: acc.me.name, role_label: acc.me.role_label } : null,
      admin: !!acc.admin, can_control: !!acc.control, read_only: !acc.admin && !acc.me,
      vidi_mena: mena,
      ...(mena ? { pary: menaParov(v, ucty) } : {}),
      ...(acc.admin ? { view_link: v.view_token ? odkaz(v.view_token) : '', admin_link: APP_URL + '/vecer/a/' + v._id,
        ziaci, diplom: v.diplom || {}, duplicity: ziaci.filter(z => z.ucty > 1).map(z => ({ name: z.name, ucty: z.ucty })) } : {}),
    };
  }

  // ── Zámok na večer ─────────────────────────────────────────────────────────
  // Dvaja z tímu klikajú naraz (kvety ✓, diplomy ✓) — bez zámku by druhý zápis
  // prepísal prvý, lebo sa ukladá celý dokument.
  const fronty = new Map();
  function soZamkom(id, fn){
    const pred = fronty.get(id) || Promise.resolve();
    const beh = pred.then(fn, fn);
    fronty.set(id, beh.catch(() => {}));
    return beh;
  }

  const nsp = io.of('/vecer');
  nsp.on('connection', async socket => {
    try{
      const a = socket.handshake.auth || {};
      const acc = await pristup({ t: a.t, id: a.id, uid: socket.request && socket.request.session && socket.request.session.uid });
      if(!acc){ socket.emit('vecer_chyba', 'Odkaz neplatí'); socket.disconnect(true); return; }
      socket.join('v:' + acc.v._id);
    }catch(e){ socket.disconnect(true); }
  });
  const rozposli = (v, kind) => nsp.to('v:' + v._id).emit('vecer', { rev: v.rev || 0, kind, live: v.live || null });

  // ── Push notifikácie ───────────────────────────────────────────────────────
  // Stránka zacinká len kým je otvorená; zamknutý telefón zobudí iba push.
  // VAPID kľúče sa vygenerujú raz a ležia v DB (nie v gite, repo je verejné).
  let vapidP = null;
  function vapid(){
    if(!webpush) return Promise.resolve(null);
    return vapidP || (vapidP = (async () => {
      let s = await q.one(db.settings, { key: 'vapid_keys' });
      if(!s){ s = { value: webpush.generateVAPIDKeys() }; await q.insert(db.settings, { key: 'vapid_keys', value: s.value, at: nowISO() }); }
      webpush.setVapidDetails(/^https:/.test(APP_URL) ? APP_URL : 'https://app.fusionacademy.sk', s.value.publicKey, s.value.privateKey);
      return s.value.publicKey;
    })().catch(e => { vapidP = null; throw e; }));
  }

  // Text notifikácie pre konkrétny telefón — kto je na rade, dostane „Si na rade".
  function obsahPushu(v, druh, sub, extra){
    const L = v.live || {}, P = v.program || [], casy = planCasy(v);
    const m = (v.team || []).find(t => t.id === sub.member_id);
    const moj = p => !!(m && p && (p.who || []).includes(m.id));
    const zaklad = { tag: 'vecer-' + v._id, url: sub.url || '/' };
    if(druh === 'bod'){
      const p = P[L.idx], d = P[L.idx + 1]; if(!p) return null;
      return { ...zaklad, title: (moj(p) ? '👉 Si na rade: ' : '▶ Teraz: ') + p.title,
        body: d ? 'Ďalej: ' + d.title + (casy[L.idx + 1] ? ' (plán ' + casy[L.idx + 1] + ')' : '') : 'Posledný bod programu',
        ja: moj(p), vibrate: moj(p) ? [450, 150, 450, 150, 450] : [250, 120, 250] };
    }
    if(druh === 'varuj'){
      const d = P[L.idx + 1]; if(!d) return null;
      return { ...zaklad, title: (moj(d) ? '👉 O ' + extra.min + ' min si na rade: ' : '⏭ O ' + extra.min + ' min: ') + d.title,
        body: 'Teraz: ' + ((P[L.idx] || {}).title || ''), ja: moj(d), vibrate: moj(d) ? [300, 100, 300] : [150] };
    }
    if(druh === 'vyprsal'){
      if(!(sub.member_id === 'admin' || (m && m.can_control))) return null;
      const d = P[L.idx + 1];
      return { ...zaklad, title: '⏰ Čas bodu vypršal', body: d ? 'Ďalej: ' + d.title : 'Posledný bod — ukonči večer', vibrate: [200] };
    }
    if(druh === 'msg'){
      const g = L.msg; if(!g) return null;
      const cielene = (g.to || []).length > 0;
      if(cielene && !(m && g.to.includes(m.id)) && sub.member_id !== 'admin') return null;
      return { ...zaklad, tag: zaklad.tag + '-msg', title: '📣 ' + g.text, body: g.from ? 'od: ' + g.from : 'Správa tímu',
        ja: cielene, vibrate: cielene ? [500, 150, 500] : [200, 100, 200] };
    }
    if(druh === 'koniec') return { ...zaklad, title: '🎉 Venček skončil', body: 'Ďakujeme celému tímu!', vibrate: [300, 120, 300] };
    return null;
  }

  async function posliPush(v, druh, extra){
    const subs = await q.find(db.vencek_vecer_push, { vecer_id: v._id });
    if(!subs.length) return 0;
    const kluc = await vapid().catch(() => null);
    if(!kluc) return 0;
    let n = 0;
    await Promise.all(subs.map(async s => {
      const d = obsahPushu(v, druh, s, extra || {}); if(!d) return;
      const payload = JSON.stringify(d);
      try{
        // QA: šifrovanie sa overí naostro, ale nič neodíde von.
        if(process.env.PUSH_FAKE === '1'){
          await webpush.generateRequestDetails(s.sub, payload, { TTL: 300 });
          fs.appendFileSync(path.join(DATA_DIR, 'push-fake.jsonl'), JSON.stringify({ member_id: s.member_id, druh, ...d }) + '\n');
          n++; return;
        }
        await webpush.sendNotification(s.sub, payload, { TTL: druh === 'varuj' || druh === 'vyprsal' ? 120 : 600, urgency: 'high' });
        n++;
      }catch(e){
        // 404/410 = telefón odber zrušil (odinštaloval, zmazal dáta) — upraceme.
        if(e && (e.statusCode === 404 || e.statusCode === 410)) await q.remove(db.vencek_vecer_push, { _id: s._id }, {});
        else console.error('vecer push:', e && e.statusCode || '', e && e.message);
      }
    }));
    return n;
  }

  // „O 2 min…" a „čas vypršal" musia prísť aj na zamknutý telefón — preto
  // časovač beží na serveri, nie v stránke.
  const casovace = new Map();
  const MINUTA = +process.env.VECER_MINUTA_MS || 60000;   // QA skracuje minútu na sekundu
  function zrusCasovace(id){ (casovace.get(id) || []).forEach(clearTimeout); casovace.delete(id); }
  function naplanuj(v){
    zrusCasovace(v._id);
    const L = v.live || {}; if(L.status !== 'bezi') return;
    const p = (v.program || [])[L.idx]; if(!p) return;
    const zostava = (+p.dur || 0) * MINUTA - (Date.now() - Date.parse(L.point_started_at) - (+L.pause_ms || 0));
    const warn = (v.warn_min == null ? 2 : v.warn_min) * MINUTA, znacka = L.point_started_at, t = [];
    const ak = (druh, extra) => async () => {
      try{
        const n = await q.one(db.vencek_vecery, { _id: v._id });
        if(n && n.live && n.live.status === 'bezi' && n.live.point_started_at === znacka) await posliPush(n, druh, extra);
      }catch(e){ console.error('vecer casovac:', e.message); }
    };
    if(warn > 0 && (v.program || [])[L.idx + 1] && zostava - warn > 0) t.push(setTimeout(ak('varuj', { min: Math.round(warn / MINUTA) }), zostava - warn));
    if(zostava > 0) t.push(setTimeout(ak('vyprsal'), zostava));
    casovace.set(v._id, t);
  }
  async function pushPoZmene(v, op, pred){
    const L = v.live || {};
    if(op === 'live.msg') return posliPush(v, 'msg');
    if(op === 'live.pause' || op === 'live.reset'){ zrusCasovace(v._id); return; }
    if(op === 'live.resume'){ naplanuj(v); return; }
    if(L.status === 'koniec'){ zrusCasovace(v._id); if(pred.status !== 'koniec') await posliPush(v, 'koniec'); return; }
    if(L.status === 'bezi' && (L.idx !== pred.idx || L.point_started_at !== pred.point_started_at)){ naplanuj(v); await posliPush(v, 'bod'); }
  }
  // Po reštarte servera obnov časovače večera, ktorý práve beží.
  setTimeout(async () => {
    try{ for(const v of await q.find(db.vencek_vecery, {})) if(v.live && v.live.status === 'bezi') naplanuj(v); }catch(e){}
  }, 5000);

  // ── Operácie ───────────────────────────────────────────────────────────────
  const LEN_ADMIN = new Set(['item.del', 'team.set', 'team.del', 'team.token', 'prog.set', 'prog.del', 'prog.move',
    'meta.set', 'live.reset', 'items.costs', 'team.costs', 'pary.set']);
  const RIADENIE = new Set(['live.start', 'live.next', 'live.prev', 'live.goto', 'live.pause', 'live.resume', 'live.end', 'live.msg']);

  function upravPolozku(v, vstup, kto, pocet){
    const items = v.items || (v.items = []);
    let it = vstup.id ? items.find(x => x.id === vstup.id) : null;
    if(vstup.id && !it) throw new Error('Položka už neexistuje');
    if(!it){
      const name = txt(vstup.name, 120);
      if(!name) throw new Error('Napíš, čo treba');
      it = { id: nid(), cat: 'nakup', name, qty: null, have: 0, unit: '', stav: 'nie', who: '', price: null, note: '' };
      items.push(it);
    }
    if(vstup.name != null && txt(vstup.name, 120)) it.name = txt(vstup.name, 120);
    if(vstup.cat != null && KAT.includes(vstup.cat)) it.cat = vstup.cat;
    if(vstup.unit != null) it.unit = txt(vstup.unit, 12);
    if(vstup.who != null) it.who = txt(vstup.who, 60);
    if(vstup.note != null) it.note = txt(vstup.note, 300);
    if(vstup.price !== undefined) it.price = suma(vstup.price);
    // Ručne zadaný počet vypne „počet podľa žiakov"; zaškrtnutie ho zapne.
    if(vstup.na_ziaka === true){ it.na_ziaka = true; if(!it.unit) it.unit = 'ks'; }
    else if(vstup.qty !== undefined || vstup.na_ziaka === false) it.na_ziaka = false;
    if(vstup.qty !== undefined && !it.na_ziaka){ it.qty = vstup.qty === '' || vstup.qty == null ? null : cislo(vstup.qty, 1, 9999); }
    obnovPocet(it, pocet);
    const q2 = it.qty;
    // Stav a počet idú spolu: ťuknutie na „máme" doplní počet, zmena počtu
    // prepočíta stav. Bez počtu sa ukladá len stav.
    if(vstup.have !== undefined && vstup.have !== null){
      it.have = cislo(vstup.have, 0, 9999) || 0;
      if(q2) it.stav = it.have >= q2 ? 'ok' : it.have > 0 ? 'pol' : 'nie';
      else it.stav = it.have > 0 ? 'ok' : 'nie';
    }
    if(vstup.stav != null && STAV.includes(vstup.stav)){
      it.stav = vstup.stav;
      if(q2){
        if(it.stav === 'ok') it.have = q2;
        else if(it.stav === 'nie') it.have = 0;
        else if(!(it.have > 0 && it.have < q2)) it.have = Math.max(1, Math.round(q2 / 2));
      }
    }
    it.updated_by = kto; it.updated_at = nowISO();
    return it;
  }

  function upravClena(v, vstup){
    const team = v.team || (v.team = []);
    let m = vstup.id ? team.find(x => x.id === vstup.id) : null;
    if(vstup.id && !m) throw new Error('Člen tímu už neexistuje');
    if(!m){
      const role = ROLY[vstup.role] ? vstup.role : 'pomoc';
      m = { id: nid(), role, role_label: ROLY[role].t, name: '', phone: '', dohoda: 'hladame', price: null,
        zaloha: false, note: '', can_control: false, token: token() };
      team.push(m);
    }
    if(vstup.role != null && ROLY[vstup.role]) m.role = vstup.role;
    if(vstup.role_label != null) m.role_label = txt(vstup.role_label, 40) || (ROLY[m.role] || {}).t;
    if(vstup.name != null) m.name = txt(vstup.name, 80);
    if(vstup.phone != null) m.phone = txt(vstup.phone, 30).replace(/[^\d+ ]/g, '');
    if(vstup.dohoda != null && DOHODA.includes(vstup.dohoda)) m.dohoda = vstup.dohoda;
    if(vstup.note != null) m.note = txt(vstup.note, 300);
    if(vstup.price !== undefined) m.price = suma(vstup.price);
    if(vstup.zaloha != null) m.zaloha = !!vstup.zaloha;
    if(vstup.can_control != null) m.can_control = !!vstup.can_control;
    return m;
  }

  function upravBod(v, vstup){
    const prog = v.program || (v.program = []);
    let p = vstup.id ? prog.find(x => x.id === vstup.id) : null;
    if(vstup.id && !p) throw new Error('Bod programu už neexistuje');
    if(!p){
      const title = txt(vstup.title, 120);
      if(!title) throw new Error('Napíš názov bodu');
      p = { id: nid(), at: '', dur: 10, title, who: [], script: '', music: '', note: '' };
      const za = vstup.after ? prog.findIndex(x => x.id === vstup.after) : -1;
      if(za >= 0) prog.splice(za + 1, 0, p); else prog.push(p);
    }
    if(vstup.title != null && txt(vstup.title, 120)) p.title = txt(vstup.title, 120);
    if(vstup.at != null) p.at = hhmm(vstup.at);
    if(vstup.dur != null) p.dur = cislo(vstup.dur, 1, 600) || 10;
    if(vstup.script != null) p.script = txt(vstup.script, 3000);
    if(vstup.music != null) p.music = txt(vstup.music, 200);
    if(vstup.note != null) p.note = txt(vstup.note, 300);
    if(vstup.ukaz_pary != null) p.ukaz_pary = !!vstup.ukaz_pary;
    if(Array.isArray(vstup.who)){
      const ids = new Set((v.team || []).map(t => t.id));
      p.who = vstup.who.map(String).filter(x => ids.has(x));
    }
    return p;
  }

  // Posun programu. from = index, z ktorého riadiaci klikal — keď naraz klikne
  // moderátor aj Marek, druhý klik sa zahodí a program neskočí o dva body.
  function riadenie(v, op, b, kto){
    const n = (v.program || []).length;
    const L = v.live = { status: 'pred', idx: -1, log: [], ...(v.live || {}) };
    const teraz = nowISO();
    const zapisKoniec = () => { const l = L.log[L.log.length - 1]; if(l && !l.end) l.end = teraz; };
    const zacniBod = i => {
      zapisKoniec();
      L.idx = i; L.point_started_at = teraz; L.pause_ms = 0; L.paused_at = null; L.status = 'bezi';
      const p = v.program[i];
      L.log.push({ id: p.id, title: p.title, start: teraz, by: kto });
      if(L.log.length > 200) L.log = L.log.slice(-200);
    };
    if(['live.next', 'live.prev', 'live.goto'].includes(op) && !n) throw new Error('Program je prázdny');
    if(b.from != null && ['live.next', 'live.prev'].includes(op) && +b.from !== L.idx) return { ignored: true };
    switch(op){
      case 'live.start':
        if(!n) throw new Error('Program je prázdny');
        if(L.status === 'bezi' || L.status === 'pauza') return { ignored: true };
        L.started_at = teraz; L.ended_at = null; L.log = [];
        zacniBod(0); break;
      case 'live.next':
        if(L.status === 'pred'){ L.started_at = teraz; zacniBod(0); break; }
        if(L.status === 'koniec') return { ignored: true };
        if(L.idx >= n - 1){ zapisKoniec(); L.status = 'koniec'; L.ended_at = teraz; L.paused_at = null; break; }
        zacniBod(L.idx + 1); break;
      case 'live.prev':
        // Po omylom ukončenom večere „späť" vráti posledný bod, nie predposledný.
        if(L.status === 'koniec'){ L.ended_at = null; zacniBod(Math.max(0, Math.min(L.idx, n - 1))); break; }
        if(L.idx <= 0) return { ignored: true };
        zacniBod(Math.min(L.idx - 1, n - 1)); break;
      case 'live.goto': {
        const i = cislo(b.idx, 0, n - 1);
        if(i == null) throw new Error('Neplatný bod');
        if(L.status === 'pred' || !L.started_at) L.started_at = teraz;
        L.ended_at = null;
        zacniBod(i); break;
      }
      case 'live.pause':
        if(L.status !== 'bezi') return { ignored: true };
        L.status = 'pauza'; L.paused_at = teraz; break;
      case 'live.resume':
        if(L.status !== 'pauza') return { ignored: true };
        L.pause_ms = (+L.pause_ms || 0) + Math.max(0, Date.now() - Date.parse(L.paused_at));
        L.paused_at = null; L.status = 'bezi'; break;
      case 'live.end':
        if(L.status === 'koniec') return { ignored: true };
        zapisKoniec(); L.status = 'koniec'; L.ended_at = teraz; L.paused_at = null; break;
      case 'live.reset':
        v.live = { status: 'pred', idx: -1, log: [] }; break;
      case 'live.msg': {
        const text = txt(b.text, 160);
        if(!text) throw new Error('Napíš správu');
        const ids = new Set((v.team || []).map(t => t.id));
        L.msg = { id: nid(), text, at: teraz, from: kto, to: Array.isArray(b.to) ? b.to.map(String).filter(x => ids.has(x)) : [] };
        break;
      }
    }
    return {};
  }

  async function vykonaj(acc, b){
    const op = String(b.op || '');
    if(LEN_ADMIN.has(op) && !acc.admin) throw Object.assign(new Error('Toto môže len admin'), { status: 403 });
    if(RIADENIE.has(op) && !acc.control) throw Object.assign(new Error('Program posúva moderátor alebo admin'), { status: 403 });
    if(op === 'item.set' && !acc.admin && !acc.me) throw Object.assign(new Error('Tento odkaz je len na pozeranie'), { status: 403 });
    if(!LEN_ADMIN.has(op) && !RIADENIE.has(op) && op !== 'item.set') throw Object.assign(new Error('Neznáma akcia'), { status: 400 });
    const kto = acc.admin ? (acc.user && acc.user.name || 'admin') : (acc.me ? (acc.me.name || acc.me.role_label) : '');
    return soZamkom(acc.v._id, async () => {
      const v = await q.one(db.vencek_vecery, { _id: acc.v._id });
      if(!v) throw Object.assign(new Error('Večer už neexistuje'), { status: 404 });
      let vysl = {}, kind = 'data';
      const predLive = { ...(v.live || {}) };
      const ceny = new Map();   // entita s nákladom → cena pred zmenou
      const zapamatajCenu = e => { if(e && e.cost_id) ceny.set(e, e.price); };
      switch(op){
        case 'item.set': {
          const ziaci = await ziaciSkupiny(v.class_id);
          zapamatajCenu((v.items || []).find(x => x.id === (b.item || {}).id));
          vysl.item = upravPolozku(v, b.item || {}, kto, deti(ziaci).length); break;
        }
        case 'item.del': v.items = (v.items || []).filter(x => x.id !== String(b.item_id || '')); break;
        case 'team.set':
          zapamatajCenu((v.team || []).find(x => x.id === (b.member || {}).id));
          vysl.member = upravClena(v, b.member || {}); break;
        case 'team.del': {
          const mid = String(b.member_id || '');
          v.team = (v.team || []).filter(x => x.id !== mid);
          (v.program || []).forEach(p => { p.who = (p.who || []).filter(x => x !== mid); });
          await q.remove(db.vencek_vecer_push, { vecer_id: v._id, member_id: mid }, { multi: true });
          break;
        }
        case 'team.token': {
          const m = (v.team || []).find(x => x.id === String(b.member_id || ''));
          if(!m) throw new Error('Člen tímu neexistuje');
          m.token = token();
          // Starý odkaz prestal platiť — jeho telefón už nemá dostávať upozornenia.
          await q.remove(db.vencek_vecer_push, { vecer_id: v._id, member_id: m.id }, { multi: true });
          break;
        }
        case 'pary.set': {
          // Poradie párov na nástup. Žiak sa berie podľa účtu (meno sa aktualizuje samo),
          // partner mimo skupiny (napr. z inej triedy) sa dá napísať menom.
          const ziaci = await ziaciSkupiny(v.class_id), platni = new Set(ziaci.map(z => z.id));
          const osoba = o => {
            if(!o) return null;
            if(o.uid && platni.has(String(o.uid))) return { uid: String(o.uid), name: (ziaci.find(z => z.id === String(o.uid)) || {}).name || '' };
            const name = txt(o.name, 80);
            return name ? { name } : null;
          };
          const vstup = Array.isArray(b.pary) ? b.pary.slice(0, 200) : [];
          v.pary = vstup.map(p => ({ id: txt(p.id, 20) || nid(), a: osoba(p.a), b: osoba(p.b) })).filter(p => p.a || p.b);
          break;
        }
        case 'prog.set': vysl.point = upravBod(v, b.point || {}); break;
        case 'prog.del': v.program = (v.program || []).filter(x => x.id !== String(b.point_id || '')); break;
        case 'prog.move': {
          const pr = v.program || [], i = pr.findIndex(x => x.id === String(b.point_id || '')), j = i + (+b.dir < 0 ? -1 : 1);
          if(i < 0 || j < 0 || j >= pr.length) return { ignored: true };
          [pr[i], pr[j]] = [pr[j], pr[i]]; break;
        }
        case 'meta.set':
          if(b.title != null && txt(b.title, 120)) v.title = txt(b.title, 120);
          if(b.start_time != null) v.start_time = hhmm(b.start_time);
          if(b.warn_min != null) v.warn_min = cislo(b.warn_min, 0, 30);
          if(b.notes != null) v.notes = txt(b.notes, 2000);
          if(b.diplom && typeof b.diplom === 'object'){
            const d = v.diplom = { ...(v.diplom || {}) };
            for(const [k, n] of [['nadpis', 40], ['text', 160], ['podpis1', 60], ['podpis1_rola', 60], ['podpis2', 60], ['podpis2_rola', 60]])
              if(b.diplom[k] != null) d[k] = txt(b.diplom[k], n);
          }
          break;
        case 'team.costs': {
          // Dohodnuté honoráre (DJ, fotograf…) → náklady skupiny, každý raz.
          let n = 0, spolu = 0;
          for(const m of v.team || []){
            if(m.cost_id || m.dohoda !== 'dohodnute' || !(+m.price > 0)) continue;
            const k = await q.insert(db.venceky_costs, { school_id: null, class_id: v.class_id,
              label: 'Venčekový večer: ' + (m.role_label || 'tím') + (m.name ? ' — ' + m.name : ''), amount: +m.price,
              date: nowISO().slice(0, 10), source: 'vencek_vecer', vecer_id: v._id, created_at: nowISO() });
            m.cost_id = k._id; n++; spolu += +m.price;
          }
          vysl.costs = { count: n, total: Math.round(spolu * 100) / 100 };
          break;
        }
        case 'items.costs': {
          // Kúpené veci s cenou → náklady skupiny (zisk venčeka v prehľade). Každá raz.
          let n = 0, spolu = 0;
          for(const it of v.items || []){
            if(it.cost_id || it.stav === 'nie' || !(+it.price > 0)) continue;
            const k = await q.insert(db.venceky_costs, { school_id: null, class_id: v.class_id,
              label: 'Venčekový večer: ' + it.name, amount: +it.price, date: nowISO().slice(0, 10),
              source: 'vencek_vecer', vecer_id: v._id, created_at: nowISO() });
            it.cost_id = k._id; n++; spolu += +it.price;
          }
          vysl.costs = { count: n, total: Math.round(spolu * 100) / 100 };
          break;
        }
        default:
          if(RIADENIE.has(op) || op === 'live.reset'){
            const r = riadenie(v, op, b, kto);
            if(r.ignored) return { ignored: true };
            kind = op === 'live.msg' ? 'msg' : 'live';
          }
      }
      // Cena veci alebo honorár, ktorý už je v nákladoch, sa zmenil → náklad ide s ním.
      for(const [e, pred] of ceny){
        if(e.price === pred) continue;
        if(+e.price > 0) await q.update(db.venceky_costs, { _id: e.cost_id }, { $set: { amount: +e.price, updated_at: nowISO() } });
        else { await q.remove(db.venceky_costs, { _id: e.cost_id }, {}); e.cost_id = null; }
      }
      v.rev = (v.rev || 0) + 1; v.updated_at = nowISO();
      await q.update(db.vencek_vecery, { _id: v._id }, v);
      rozposli(v, kind);
      if(kind === 'live' || kind === 'msg') pushPoZmene(v, op, predLive).catch(e => console.error('vecer push:', e.message));
      return { ...vysl, v };
    });
  }

  // ── API: stav a operácie (admin aj tím) ────────────────────────────────────
  app.get('/api/vecer/stav', async (req, res) => {
    try{
      const acc = await pristup({ t: req.query.t, id: req.query.id, uid: req.session && req.session.uid });
      if(!acc) return res.status(404).json({ error: 'Tento odkaz neplatí. Vypýtaj si nový od Mareka.' });
      res.json(await pohlad(acc));
    }catch(e){ res.status(500).json({ error: e.message }); }
  });

  app.post('/api/vecer/op', async (req, res) => {
    try{
      const b = req.body || {};
      const acc = await pristup({ t: b.t, id: b.id, uid: req.session && req.session.uid });
      if(!acc) return res.status(404).json({ error: 'Tento odkaz neplatí. Vypýtaj si nový od Mareka.' });
      const r = await vykonaj(acc, b);
      if(r.ignored) return res.json({ ok: true, ignored: true, ...(await pohlad(acc)) });
      const po = await pristup({ t: b.t, id: b.id, uid: req.session && req.session.uid });
      res.json({ ...(po ? await pohlad(po) : { ok: true }), ...(r.item ? { item: r.item } : {}), ...(r.costs ? { costs: r.costs } : {}) });
    }catch(e){ res.status(e.status || 400).json({ error: e.message }); }
  });

  // ── API: admin ─────────────────────────────────────────────────────────────
  // Zoznam skupín s večerom — čo je pripravené a či je dohodnutý DJ a fotograf.
  app.get('/api/admin/vecer/zoznam', adminAuth, async (req, res) => {
    try{
      const skupiny = await q.find(db.venceky_classes, {});
      const skoly = Object.fromEntries((await q.find(db.venceky_schools, {})).map(s => [s._id, s]));
      const vecery = await q.find(db.vencek_vecery, {});
      const ziaci = (await q.find(db.users, {})).filter(u => u.venceky_class_id && (u.venceky_role || 'student') === 'student' && u.active !== false);
      const out = skupiny.map(c => {
        const v = vecery.find(x => x.class_id === c._id) || null;
        const items = v ? v.items || [] : [];
        const tim = v ? v.team || [] : [];
        const rola = r => { const m = tim.find(t => t.role === r); return m ? m.dohoda : null; };
        return { class_id: c._id, class_name: c.name, code: c.code, school: (skoly[c.school_id] || {}).name || '',
          event_date: c.event_date || '', event_venue: c.event_venue || '', completed: !!c.completed,
          students: deti(ziaci.filter(u => u.venceky_class_id === c._id)).length,
          vecer: v ? { id: v._id, title: v.title, status: (v.live || {}).status || 'pred',
            items_ok: items.filter(i => i.stav === 'ok').length, items_pol: items.filter(i => i.stav === 'pol').length, items: items.length,
            team_ok: tim.filter(t => t.dohoda === 'dohodnute').length, team: tim.length,
            dj: rola('dj'), foto: rola('foto'), program: (v.program || []).length } : null };
      }).sort((a, b) => (a.event_date || '9999').localeCompare(b.event_date || '9999'));
      res.json({ ok: true, skupiny: out, roly: ROLY });
    }catch(e){ res.status(500).json({ error: e.message }); }
  });

  app.post('/api/admin/vecer/zaloz', adminAuth, async (req, res) => {
    try{
      const c = await q.one(db.venceky_classes, { _id: String(req.body.class_id || '') });
      if(!c) return res.status(404).json({ error: 'Skupina nenájdená' });
      const uz = await q.one(db.vencek_vecery, { class_id: c._id });
      if(uz) return res.json({ ok: true, id: uz._id, existed: true });
      const s = await q.one(db.venceky_schools, { _id: c.school_id });
      const ziakov = deti(await ziaciSkupiny(c._id)).length;
      const { team, items, program, diplom } = sablona(c, ziakov);
      const v = await q.insert(db.vencek_vecery, { class_id: c._id,
        title: 'Venčekový večer — ' + ((s && s.name) || c.name), start_time: '', warn_min: 2, notes: '',
        team, items, program, diplom, pary: [], view_token: token(), live: { status: 'pred', idx: -1, log: [] }, rev: 1,
        created_by: req.user.name, created_at: nowISO(), updated_at: nowISO() });
      console.log('✨ Venčekový večer založený: ' + v.title + ' (' + c.code + ')');
      res.json({ ok: true, id: v._id });
    }catch(e){ res.status(500).json({ error: e.message }); }
  });

  app.post('/api/admin/vecer/zmaz', adminAuth, async (req, res) => {
    try{
      const v = await q.one(db.vencek_vecery, { _id: String(req.body.id || '') });
      if(!v) return res.status(404).json({ error: 'Večer nenájdený' });
      await q.remove(db.vencek_vecery, { _id: v._id }, {});
      await q.remove(db.vencek_vecer_push, { vecer_id: v._id }, { multi: true });
      zrusCasovace(v._id);
      nsp.to('v:' + v._id).emit('vecer_chyba', 'Tento večer bol zmazaný');
      res.json({ ok: true });
    }catch(e){ res.status(500).json({ error: e.message }); }
  });

  // QR osobného odkazu — DJ si ho na mieste naskenuje z Marekovho telefónu.
  app.get('/api/admin/vecer/qr', adminAuth, async (req, res) => {
    try{
      const v = await q.one(db.vencek_vecery, { _id: String(req.query.id || '') });
      if(!v) return res.status(404).json({ error: 'Večer nenájdený' });
      const m = req.query.m === 'view' ? { token: v.view_token } : (v.team || []).find(x => x.id === String(req.query.m || ''));
      if(!m || !m.token) return res.status(404).json({ error: 'Člen tímu nenájdený' });
      const url = odkaz(m.token);
      res.json({ ok: true, url, qr: await QR.toDataURL(url, { margin: 1, width: 360 }) });
    }catch(e){ res.status(500).json({ error: e.message }); }
  });

  // ── API: push odber telefónu ───────────────────────────────────────────────
  app.get('/api/vecer/push-kluc', async (req, res) => {
    try{
      const k = await vapid();
      if(!k) return res.status(503).json({ error: 'Upozornenia na zamknutý telefón teraz nejdú' });
      res.json({ ok: true, key: k });
    }catch(e){ res.status(500).json({ error: e.message }); }
  });
  app.post('/api/vecer/push', async (req, res) => {
    try{
      const b = req.body || {};
      const acc = await pristup({ t: b.t, id: b.id, uid: req.session && req.session.uid });
      if(!acc) return res.status(404).json({ error: 'Tento odkaz neplatí.' });
      const s = b.sub || {}, k = s.keys || {}, endpoint = String(s.endpoint || '');
      // Len skutočné push služby prehliadačov — server nemá posielať na ľubovoľnú adresu.
      if(!/^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)\/\S{4,900}$/i.test(endpoint)
        || typeof k.p256dh !== 'string' || typeof k.auth !== 'string'
        || k.p256dh.length > 200 || k.auth.length > 100 || !k.p256dh || !k.auth) return res.status(400).json({ error: 'Neplatný odber' });
      const doc = { vecer_id: acc.v._id, member_id: acc.admin ? 'admin' : acc.me ? acc.me.id : 'view',
        url: acc.admin ? '/vecer/a/' + acc.v._id : '/vecer/' + String(b.t),
        endpoint, sub: { endpoint, keys: { p256dh: k.p256dh, auth: k.auth } },
        ua: String(req.headers['user-agent'] || '').slice(0, 160), updated_at: nowISO() };
      const uz = await q.one(db.vencek_vecer_push, { endpoint });
      if(uz) await q.update(db.vencek_vecer_push, { _id: uz._id }, { $set: doc });
      else {
        if(await q.count(db.vencek_vecer_push, { vecer_id: acc.v._id }) >= 300) return res.status(429).json({ error: 'Priveľa telefónov' });
        await q.insert(db.vencek_vecer_push, { ...doc, created_at: nowISO() });
      }
      res.json({ ok: true });
    }catch(e){ res.status(500).json({ error: e.message }); }
  });
  app.post('/api/vecer/push-zrus', async (req, res) => {
    try{
      const b = req.body || {};
      const acc = await pristup({ t: b.t, id: b.id, uid: req.session && req.session.uid });
      if(!acc) return res.status(404).json({ error: 'Tento odkaz neplatí.' });
      await q.remove(db.vencek_vecer_push, { vecer_id: acc.v._id, endpoint: String(b.endpoint || '') }, {});
      res.json({ ok: true });
    }catch(e){ res.status(500).json({ error: e.message }); }
  });
  // iPhone dovolí upozornenia len stránke pridanej na plochu — manifest ju otvorí
  // presne na odkaze toho člena tímu, nie na nástenke appky.
  app.get('/api/vecer/manifest', (req, res) => {
    const t = String(req.query.t || ''), id = String(req.query.id || '');
    const start = t ? '/vecer/' + encodeURIComponent(t) : '/vecer/a/' + encodeURIComponent(id);
    res.type('application/manifest+json').send(JSON.stringify({
      name: 'Venčekový večer — tím', short_name: 'Venček', start_url: start, scope: '/vecer/', display: 'standalone',
      background_color: '#0B0A07', theme_color: '#0B0A07', lang: 'sk',
      icons: [{ src: '/logo-mark.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/logo-mark.png', sizes: '192x192', type: 'image/png', purpose: 'any' }] }));
  });

  // ── API: tlač (diplomy, scenár) ────────────────────────────────────────────
  app.get('/api/vecer/tlac', async (req, res) => {
    try{
      const acc = await pristup({ t: req.query.t, id: req.query.id, uid: req.session && req.session.uid });
      if(!acc) return res.status(404).json({ error: 'Tento odkaz neplatí.' });
      const v = acc.v, { c, s } = await skupina(v), ucty = await ziaciSkupiny(v.class_id), ziaci = deti(ucty);
      const zaklad = { ok: true, title: v.title, school: s ? s.name : '', class_name: c ? c.name : '',
        event_date: c ? c.event_date || '' : '', event_venue: c ? c.event_venue || '' : '', lecturer: c ? c.lecturer || '' : '' };
      if(req.query.co === 'diplomy'){
        if(!vidiMena(acc)) return res.status(403).json({ error: 'Diplomy s menami žiakov vidí admin, moderátor a tím pri diplomoch.' });
        // Poradie ako idú páry na parket (tak sa aj odovzdávajú), zvyšok abecedne.
        // Partner mimo kurzu (napísaný len menom) diplom nedostáva.
        const mena = [], uz = new Set();
        for(const p of menaParov(v, ucty)) for(const [uid, nm] of [[p.a_uid, p.a], [p.b_uid, p.b]])
          if(uid && nm && !uz.has(klucMena(nm))){ uz.add(klucMena(nm)); mena.push(nm); }
        for(const z of ziaci) if(!uz.has(klucMena(z.name))){ uz.add(klucMena(z.name)); mena.push(z.name); }
        const d = v.diplom || {};
        return res.json({ ...zaklad, co: 'diplomy', mena, diplom: { nadpis: d.nadpis || 'Diplom',
          text: d.text != null ? d.text : 'za úspešné absolvovanie tanečného kurzu',
          podpis1: d.podpis1 != null ? d.podpis1 : (c && c.lecturer) || '', podpis1_rola: d.podpis1_rola != null ? d.podpis1_rola : 'tanečný majster',
          podpis2: d.podpis2 || '', podpis2_rola: d.podpis2_rola != null ? d.podpis2_rola : 'riaditeľ/ka školy' } });
      }
      const casy = planCasy(v), tim = Object.fromEntries((v.team || []).map(m => [m.id, m]));
      res.json({ ...zaklad, co: 'scenar', start_time: v.start_time || '',
        team: (v.team || []).map(m => ({ role_label: m.role_label, ic: (ROLY[m.role] || ROLY.pomoc).ic, name: m.name, phone: m.phone, dohoda: m.dohoda })),
        program: (v.program || []).map((p, i) => ({ plan: casy[i], dur: p.dur, title: p.title, music: p.music, script: p.script, note: p.note,
          ukaz_pary: !!p.ukaz_pary, who: (p.who || []).map(id => tim[id]).filter(Boolean).map(m => m.role_label) })),
        ...(vidiMena(acc) ? { pary: menaParov(v, ucty) } : {}) });
    }catch(e){ res.status(500).json({ error: e.message }); }
  });

  // ── Pripomienky pred večerom (denný job o 8:00) ────────────────────────────
  // 14, 7 a 2 dni pred večerom a ráno v deň večera: čo ešte chýba. Každá raz.
  const PRIPOMIENKY_DNI = [14, 7, 2, 0];
  const escH = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  async function pripomienky(dnes){
    dnes = /^\d{4}-\d{2}-\d{2}$/.test(String(dnes || '')) ? dnes : today();
    const out = [];
    for(const v of await q.find(db.vencek_vecery, {})){
      const { c, s } = await skupina(v);
      if(!c || !c.event_date || c.completed) continue;
      const dni = Math.round((Date.parse(c.event_date + 'T12:00:00Z') - Date.parse(dnes + 'T12:00:00Z')) / 864e5);
      if(!PRIPOMIENKY_DNI.includes(dni)) continue;
      const key = 'vencek_vecer_pripomienka:' + v._id + ':' + c.event_date + ':' + dni;
      if(await q.one(db.notifications, { key })) continue;
      const ziaci = deti(await ziaciSkupiny(v.class_id));
      const items = (v.items || []).map(it => obnovPocet({ ...it }, ziaci.length));
      const chyba = k => items.filter(i => i.cat === k && i.stav !== 'ok');
      const zoznam = arr => arr.slice(0, 6).map(i => i.name + (i.qty ? ' (' + (i.have || 0) + '/' + i.qty + ')' : '')).join(', ') + (arr.length > 6 ? ' a ďalšie' : '');
      const nakup = chyba('nakup'), prip = chyba('priprava'), zbal = chyba('zbalit');
      const tim = (v.team || []).filter(t => t.dohoda !== 'dohodnute');
      const riadky = [];
      if(tim.length) riadky.push('Tím ešte nie je dohodnutý: ' + tim.map(t => t.role_label).join(', '));
      if(nakup.length) riadky.push('Nakúpiť (' + nakup.length + '): ' + zoznam(nakup));
      if(prip.length) riadky.push('Prichystať (' + prip.length + '): ' + zoznam(prip));
      if(dni <= 2 && zbal.length) riadky.push('Zbaliť (' + zbal.length + '): ' + zoznam(zbal));
      if(!v.start_time) riadky.push('Nie je zadaný začiatok programu.');
      if(dni <= 2) riadky.push('Pošli tímu osobné odkazy (Tím → odkaz), nech si ich otvoria a zapnú upozornenia.');
      const hotovo = !tim.length && !nakup.length && !prip.length && !(dni <= 2 && zbal.length) && !!v.start_time;
      const kde = (s && s.name) || c.name, kedy = dni === 0 ? 'je dnes' : 'o ' + dni + ' dní';
      const title = '✨ Venček ' + kde + ' ' + kedy + (hotovo ? ' — všetko pripravené ✅' : ' — čo ešte chýba');
      const body = hotovo ? 'Nákup, príprava aj tím sú hotové.' + (dni <= 2 ? ' Pošli tímu osobné odkazy.' : '') : riadky.join(' · ');
      const html = '<ul style="color:#ddd;line-height:1.6;padding-left:18px">' + (hotovo ? '<li>Nákup, príprava aj tím sú hotové. ✅</li>' : riadky.map(r => '<li>' + escH(r) + '</li>').join('')) + '</ul>';
      for(const a of await q.find(db.users, { is_admin: true })){
        if(a.active === false) continue;
        await q.insert(db.notifications, { user_id: a._id, type: 'venceky', key, title, body, read: false, created_at: nowISO() }).catch(() => {});
        if(a.email && sendMail && emailTemplate)
          await sendMail(a.email, title, emailTemplate(title, html, 'Otvoriť prípravu večera', APP_URL + '/admin#vecer'),
            { template: 'vencek_vecer_pripomienka', priority: 2 }).catch(() => {});
      }
      out.push({ vecer: v._id, dni, key, hotovo });
    }
    return out;
  }
  app.post('/api/admin/vecer/pripomienky', adminAuth, async (req, res) => {
    try{ res.json({ ok: true, sent: await pripomienky(req.body && req.body.datum) }); }
    catch(e){ res.status(500).json({ error: e.message }); }
  });

  return { ROLY, sablona, planCasy, pripomienky };
};
