// ═══════════════════════════════════════════════════════════════════════════════
// HODINA DO KALENDÁRA TELEFÓNU (.ics)
//
// Marek 19. 10. 2026 — jedna z natívnych funkcií, kvôli ktorým Apple appku pustí
// (a hlavne: klientka si hodinu pridá medzi svoje udalosti a telefón jej ju
// pripomenie dve hodiny vopred, aj keď appku vôbec neotvorí).
//
// GET /api/kalendar/hodina.ics?booking_id=…   — skupinová hodina z rezervácie
// GET /api/kalendar/sukromna.ics?id=…          — súkromná hodina
// Obe len pre prihlásenú klientku a len pre JEJ rezervácie.
// ═══════════════════════════════════════════════════════════════════════════════
module.exports = function mountKalendar(ctx){
  const { app, db, q, auth, APP_URL } = ctx;

  const dvoj = n => String(n).padStart(2,'0');
  // „2026-10-20" + „19:00" → „20261020T190000" (miestny čas, pásmo rieši VTIMEZONE)
  const kedy = (den, cas) => {
    const [r,m,d] = String(den||'').slice(0,10).split('-');
    const [h,mi]  = String(cas||'19:00').split(':');
    return `${r}${m}${d}T${dvoj(+h||0)}${dvoj(+mi||0)}00`;
  };
  const plusMinut = (den, cas, minut) => {
    const [r,m,d] = String(den||'').slice(0,10).split('-').map(Number);
    const [h,mi]  = String(cas||'19:00').split(':').map(Number);
    const x = new Date(Date.UTC(r, m-1, d, h||0, mi||0));
    x.setUTCMinutes(x.getUTCMinutes() + minut);
    return `${x.getUTCFullYear()}${dvoj(x.getUTCMonth()+1)}${dvoj(x.getUTCDate())}T${dvoj(x.getUTCHours())}${dvoj(x.getUTCMinutes())}00`;
  };
  // V .ics sa čiarky, bodkočiarky a zlomy riadkov musia escapovať, inak sa súbor rozsype
  const esc = s => String(s||'').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');

  // Bez pásma by iPhone bral čas ako UTC a hodina by v kalendári sedela o hodinu-dve vedľa.
  const PASMO = [
    'BEGIN:VTIMEZONE','TZID:Europe/Bratislava',
    'BEGIN:DAYLIGHT','TZOFFSETFROM:+0100','TZOFFSETTO:+0200','TZNAME:CEST',
    'DTSTART:19700329T020000','RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU','END:DAYLIGHT',
    'BEGIN:STANDARD','TZOFFSETFROM:+0200','TZOFFSETTO:+0100','TZNAME:CET',
    'DTSTART:19701025T030000','RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU','END:STANDARD',
    'END:VTIMEZONE'];

  function ics({ uid, nazov, miesto, popis, den, cas, minut }){
    const teraz = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    return [
      'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Fusion Academy//Rozvrh//SK','CALSCALE:GREGORIAN','METHOD:PUBLISH',
      ...PASMO,
      'BEGIN:VEVENT',
      'UID:'+uid+'@fusionacademy.sk',
      'DTSTAMP:'+teraz,
      'DTSTART;TZID=Europe/Bratislava:'+kedy(den, cas),
      'DTEND;TZID=Europe/Bratislava:'+plusMinut(den, cas, minut||60),
      'SUMMARY:'+esc(nazov),
      'LOCATION:'+esc(miesto),
      'DESCRIPTION:'+esc(popis),
      'URL:'+(APP_URL||'https://app.fusionacademy.sk')+'/client-dashboard',
      'BEGIN:VALARM','TRIGGER:-PT2H','ACTION:DISPLAY','DESCRIPTION:'+esc('Dnes máš '+nazov),'END:VALARM',
      'END:VEVENT','END:VCALENDAR'
    ].join('\r\n')+'\r\n';
  }

  const posli = (res, subor, telo) => {
    res.setHeader('Content-Type','text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="'+subor+'"');
    res.send(telo);
  };

  app.get('/api/kalendar/hodina.ics', auth, async(req,res)=>{
    try{
      const b = await q.one(db.bookings,{_id:String(req.query.booking_id||'')});
      if(!b) return res.status(404).send('Rezervácia nenájdená');
      // cudziu rezerváciu nepustíme (rodič vidí rezerváciu dieťaťa — tú zapisoval on)
      if(b.user_id!==req.session.uid && b.booked_by!==req.session.uid) return res.status(403).send('Toto nie je tvoja rezervácia');
      const c = await q.one(db.classes,{_id:b.class_id}) || {};
      const nazov = (b.class_name||c.name||'Hodina')+' — Fusion Academy';
      const trvanie = (()=>{ const z=String(b.class_time_start||c.time_start||'19:00'), k=String(c.time_end||'');
        if(!/^\d{1,2}:\d{2}$/.test(k)) return 60;
        const [h1,m1]=z.split(':').map(Number), [h2,m2]=k.split(':').map(Number);
        const r=(h2*60+m2)-(h1*60+m1); return r>0 ? r : 60; })();
      posli(res, 'hodina.ics', ics({
        uid:'booking-'+b._id, nazov,
        miesto: b.class_location||c.location||'',
        popis: 'Tešíme sa na teba! Rezerváciu nájdeš v appke.',
        den: b.booking_date, cas: b.class_time_start||c.time_start, minut:trvanie }));
    }catch(e){ res.status(500).send(e.message); }
  });

  app.get('/api/kalendar/sukromna.ics', auth, async(req,res)=>{
    try{
      const b = await q.one(db.private_bookings,{_id:String(req.query.id||'')});
      if(!b) return res.status(404).send('Hodina nenájdená');
      if(b.client_id!==req.session.uid) return res.status(403).send('Toto nie je tvoja hodina');
      posli(res, 'sukromna-hodina.ics', ics({
        uid:'private-'+b._id, nazov:'Súkromná hodina — Fusion Academy',
        miesto: b.city||b.location||'', popis:'Tréner: '+(b.trainer_name||''),
        den:b.date, cas:b.time_start, minut:b.duration_min||60 }));
    }catch(e){ res.status(500).send(e.message); }
  });
};
