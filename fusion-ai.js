/**
 * Fusion Academy – FUSION AI (fáza 1: deterministický Operations Manager)
 * CEO dashboard + ranný brief. ŽIADNE LLM — každé číslo je vypočítané z databázy
 * a spätne vysvetliteľné. Modul iba ČÍTA dáta (jediný zápis: uloženie briefu
 * a admin notifikácia). Znovupoužíva existujúce kolekcie: users, transactions,
 * bookings, classes, memberships, coach_contacts (z coach.js).
 */
'use strict';

module.exports = function initFusionAI(ctx){
  const { app, db, q, adminAuth, isTestContact } = ctx;

  const TZ='Europe/Bratislava';
  const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:TZ}).format(new Date());
  const nowISO = () => new Date().toISOString();
  const dstr = d => new Intl.DateTimeFormat('sv-SE',{timeZone:TZ}).format(d);
  const daysAgo = n => dstr(new Date(Date.now()-n*86400000));
  const round2 = x => Math.round(x*100)/100;
  // vylúčené z metrík: test účty a QA (importované @import.local sú reálni ľudia — tie NECHAŤ)
  const isExcluded = u => !u || u.is_admin || u.is_child || /@test-fa-qa\.local$|@qa-biz\.local$/i.test(String(u.email||''));
  const txDate = t => String(t.date || t.created_at || '').slice(0,10);

  // ── jeden prechod dátami (cache 5 min — dashboard aj brief z toho istého výpočtu) ──
  let _cache=null;
  async function compute(force){
    if(!force && _cache && Date.now()-_cache.at < 5*60*1000) return _cache.data;
    const [users, txs, bookings, classes, memberships] = await Promise.all([
      q.find(db.users,{}), q.find(db.transactions,{}), q.find(db.bookings,{}),
      q.find(db.classes,{}), q.find(db.memberships,{}),
    ]);
    const contacts = db.coach_contacts ? await q.find(db.coach_contacts,{}) : [];

    const T=today();
    const uById={}; for(const u of users) uById[u._id]=u;
    const okUser = id => !isExcluded(uById[id]);

    // ── OBRAT ────────────────────────────────────────────────────────────────
    const revByDate={};
    for(const t of txs){
      if(!(+t.amount>0)) continue;
      if(t.user_id && !okUser(t.user_id)) continue;
      const d=txDate(t); if(!d) continue;
      revByDate[d]=(revByDate[d]||0)+(+t.amount);
    }
    const revOn = d => round2(revByDate[d]||0);
    const revRange=(from,to)=>{ let s=0; for(const [d,v] of Object.entries(revByDate)) if(d>=from&&d<=to) s+=v; return round2(s); };
    const avgOver=(days)=> round2(revRange(daysAgo(days), daysAgo(1))/days);
    const rev={ today:revOn(T), yesterday:revOn(daysAgo(1)), avg7:avgOver(7), avg30:avgOver(30) };
    // mesiac + jednoduchý lineárny forecast (mtd / uplynulé dni × dni mesiaca)
    const dNow=new Date(); const dayOfMonth=+T.slice(8,10);
    const daysInMonth=new Date(dNow.getFullYear(), dNow.getMonth()+1, 0).getDate();
    rev.month_to_date=revRange(T.slice(0,8)+'01', T);
    rev.month_forecast=dayOfMonth>=3 ? round2(rev.month_to_date/dayOfMonth*daysInMonth) : null;

    // obrat po mestách (posledných 30 dní) — cez hodinu/klienta sa nedá vždy,
    // preto berieme mesto poslednej navštívenej hodiny klienta (best effort)
    const clsById={}; for(const c of classes) clsById[c._id]=c;
    const lastCityOf={};
    for(const b of bookings){ if(b.status!=='attended') continue; const c=clsById[b.class_id]; if(!c||c.category==='Online') continue;
      const prev=lastCityOf[b.user_id]; if(!prev || b.booking_date>prev.d) lastCityOf[b.user_id]={d:b.booking_date, city:c.location||'?'}; }

    // ── ČLENOVIA / LEADY / KONVERZIA ─────────────────────────────────────────
    const activeMemUsers=new Set();
    for(const m of memberships) if(m.status==='active' && (!m.expires_at || String(m.expires_at).slice(0,10)>=T) && okUser(m.user_id)) activeMemUsers.add(m.user_id);
    const createdOn=(u,d)=>String(u.created_at||'').slice(0,10)===d;
    const realPeople=users.filter(u=>!isExcluded(u) && (u.user_type==='client'||u.user_type==='lead'));
    const members={ active:activeMemUsers.size,
      new_today:realPeople.filter(u=>createdOn(u,T)).length,
      new_yesterday:realPeople.filter(u=>createdOn(u,daysAgo(1))).length };
    const leads={ new_today:realPeople.filter(u=>u.user_type==='lead'&&createdOn(u,T)).length,
      new_7d:realPeople.filter(u=>u.user_type==='lead'&&String(u.created_at||'').slice(0,10)>=daysAgo(7)).length };
    // prvá platba dnes = nová platiaca klientka
    const firstTx={};
    for(const t of txs){ if(!(+t.amount>0)||!t.user_id||!okUser(t.user_id)) continue; const d=txDate(t);
      if(!firstTx[t.user_id]||d<firstTx[t.user_id]) firstTx[t.user_id]=d; }
    members.new_paying_today=Object.values(firstTx).filter(d=>d===T).length;
    // konverzia: registrácie za posledných 30 dní → % s návštevou alebo platbou
    const reg30=realPeople.filter(u=>String(u.created_at||'').slice(0,10)>=daysAgo(30));
    const attendedSet=new Set(bookings.filter(b=>b.status==='attended').map(b=>b.user_id));
    const conv30=reg30.length? Math.round(100*reg30.filter(u=>attendedSet.has(u._id)||firstTx[u._id]).length/reg30.length) : null;

    // ── DNEŠNÉ REZERVÁCIE ────────────────────────────────────────────────────
    const bookingsToday=bookings.filter(b=>b.booking_date===T && b.status!=='cancelled' && okUser(b.user_id)).length;

    // ── DOCHÁDZKA PO MESTÁCH: 14 dní vs predchádzajúcich 14 ──────────────────
    const cityAtt={};
    for(const b of bookings){
      if(b.status!=='attended'||!okUser(b.user_id)) continue;
      const c=clsById[b.class_id]; if(!c||c.category==='Online') continue;
      const city=c.location||'?'; cityAtt[city]=cityAtt[city]||{cur:0,prev:0};
      if(b.booking_date>=daysAgo(14)&&b.booking_date<=T) cityAtt[city].cur++;
      else if(b.booking_date>=daysAgo(28)&&b.booking_date<daysAgo(14)) cityAtt[city].prev++;
    }
    const cities=Object.entries(cityAtt).map(([city,v])=>({ city, attendance_14d:v.cur, attendance_prev_14d:v.prev,
      change_pct: v.prev>=5 ? Math.round(100*(v.cur-v.prev)/v.prev) : null })).sort((a,b)=>b.attendance_14d-a.attendance_14d);

    // ── OBSADENOSŤ HODÍN (najbližší termín) ──────────────────────────────────
    const nextDate=dow=>{ const nd=new Date(); const diff=(dow-nd.getDay()+7)%7; return dstr(new Date(nd.getTime()+diff*86400000)); };
    const occupancy=[];
    for(const c of classes){
      if(!c.active||c.category==='Online'||/súkromn/i.test(c.name||'')||!(+c.capacity>0)) continue;
      const d=nextDate(c.day_of_week);
      if(c.only_date && c.only_date!==d) continue;
      const booked=bookings.filter(b=>b.class_id===c._id&&b.booking_date===d&&b.status!=='cancelled'&&okUser(b.user_id)).length;
      occupancy.push({ name:c.name, city:c.location||'?', day:c.day_of_week, time:c.time_start, date:d,
        booked, capacity:+c.capacity, pct:Math.round(100*booked/(+c.capacity)) });
    }
    const nearFull=occupancy.filter(o=>o.pct>=90).sort((a,b)=>b.pct-a.pct);

    // ── PRÍLEŽITOSTI ─────────────────────────────────────────────────────────
    const lastVisit={};
    for(const b of bookings){ if(b.status!=='attended') continue;
      if(!lastVisit[b.user_id]||b.booking_date>lastVisit[b.user_id]) lastVisit[b.user_id]=b.booking_date; }
    const daysSince=d=>Math.floor((new Date(T+'T12:00:00')-new Date(d+'T12:00:00'))/86400000);
    // priemerná mesačná útrata klientky (z celej histórie) — pre odhady potenciálu
    const spendOf={};
    for(const t of txs){ if(!(+t.amount>0)||!t.user_id||!okUser(t.user_id)) continue; spendOf[t.user_id]=(spendOf[t.user_id]||0)+(+t.amount); }
    const monthlySpend=u=>{ const first=firstTx[u._id]; if(!first) return 0;
      const months=Math.max(1,(new Date(T)-new Date(first))/(30*86400000)); return (spendOf[u._id]||0)/months; };

    // winback: klientky 14–120 dní bez návštevy, bez aktívneho členstva a bez vstupov
    const winback=realPeople.filter(u=>{
      if(u.user_type!=='client'||activeMemUsers.has(u._id)||(u.single_entries||0)>0) return false;
      const lv=lastVisit[u._id]; if(!lv) return false; const ds=daysSince(lv); return ds>=14&&ds<=120;
    }).map(u=>({id:u._id, name:u.name, days:daysSince(lastVisit[u._id]), monthly_spend:round2(monthlySpend(u))}))
      .sort((a,b)=>a.days-b.days);
    const winbackPotential=round2(winback.reduce((s,w)=>s+(w.monthly_spend||10),0));

    // končiace členstvá do 7 dní (odhad = posledná platba členstva danej klientky)
    const lastMemTx={};
    for(const t of txs){ if(t.type!=='membership'||!(+t.amount>0)) continue; const d=txDate(t);
      if(!lastMemTx[t.user_id]||d>lastMemTx[t.user_id].d) lastMemTx[t.user_id]={d, amount:+t.amount}; }
    const memTxAmounts=Object.values(lastMemTx).map(x=>x.amount).sort((a,b)=>a-b);
    const medianMem=memTxAmounts.length?memTxAmounts[Math.floor(memTxAmounts.length/2)]:39;
    const expiring=memberships.filter(m=>{
      if(m.status!=='active'||!m.expires_at||!okUser(m.user_id)) return false;
      const e=String(m.expires_at).slice(0,10); return e>=T && e<=daysAgo(-7);
    }).map(m=>({id:m.user_id, name:uById[m.user_id]?.name||'?', plan:m.plan_name||m.plan_id||'', expires:String(m.expires_at).slice(0,10),
      renewal_value:round2(lastMemTx[m.user_id]?.amount||medianMem)})).sort((a,b)=>a.expires<b.expires?-1:1);
    const expiringPotential=round2(expiring.reduce((s,e)=>s+e.renewal_value,0));

    // nekontaktované leady staršie ako 24 h (max 60 dní, bez kontaktu trénera a bez návštevy)
    const contactedIds=new Set(contacts.map(c=>c.lead_id));
    const uncontacted=realPeople.filter(u=>{
      if(u.user_type!=='lead'||contactedIds.has(u._id)||attendedSet.has(u._id)) return false;
      const created=String(u.created_at||'').slice(0,10);
      return created<T && created>=daysAgo(60);
    }).map(u=>({id:u._id, name:u.name, days:daysSince(String(u.created_at).slice(0,10)), source:u.lead_source||u.utm_source||''}))
      .sort((a,b)=>a.days-b.days);
    // potenciál leadov = počet × konverzia 30d × mediánová prvá platba
    const firstAmounts=[];
    for(const [uid,d] of Object.entries(firstTx)){ const t=txs.find(t2=>t2.user_id===uid&&txDate(t2)===d&&+t2.amount>0); if(t) firstAmounts.push(+t.amount); }
    firstAmounts.sort((a,b)=>a-b);
    const medianFirst=firstAmounts.length?firstAmounts[Math.floor(firstAmounts.length/2)]:10;
    const leadPotential=conv30!=null?round2(uncontacted.length*(conv30/100)*medianFirst):null;

    // upsell na členstvo: 3+ jednorazové vstupy za 60 dní, bez aktívneho členstva
    const entryCnt={};
    for(const t of txs){ if(t.type!=='single_entry'||!(+t.amount>0)||!okUser(t.user_id)) continue;
      if(txDate(t)>=daysAgo(60)) entryCnt[t.user_id]=(entryCnt[t.user_id]||0)+1; }
    const upsell=Object.entries(entryCnt).filter(([uid,n])=>n>=3&&!activeMemUsers.has(uid))
      .map(([uid,n])=>({id:uid, name:uById[uid]?.name||'?', entries_60d:n, spent_60d:round2(n*10)}))
      .sort((a,b)=>b.entries_60d-a.entries_60d);
    const upsellPotential=round2(upsell.length*medianMem);

    // ── MONEY LEFT ON THE TABLE ──────────────────────────────────────────────
    // expirované členstvá za posledných 30 dní bez obnovy
    const lapsed=memberships.filter(m=>{
      if(!m.expires_at||!okUser(m.user_id)) return false;
      const e=String(m.expires_at).slice(0,10);
      if(!(e<T && e>=daysAgo(30))) return false;
      return !activeMemUsers.has(m.user_id); // neobnovila
    }).map(m=>({id:m.user_id, name:uById[m.user_id]?.name||'?', expired:String(m.expires_at).slice(0,10),
      renewal_value:round2(lastMemTx[m.user_id]?.amount||medianMem)}));
    const lapsedPotential=round2(lapsed.reduce((s,l)=>s+l.renewal_value,0));
    const moneyLeft={ total:round2(winbackPotential+expiringPotential+(leadPotential||0)+upsellPotential+lapsedPotential),
      breakdown:[
        {key:'winback',   label:'Winback klientky (14–120 d bez návštevy)', count:winback.length,     value:winbackPotential,  how:'súčet priemernej mesačnej útraty každej klientky (min. 10 €)'},
        {key:'expiring',  label:'Členstvá končiace do 7 dní',               count:expiring.length,    value:expiringPotential, how:'súčet poslednej platby členstva každej klientky'},
        {key:'lapsed',    label:'Neobnovené členstvá (posledných 30 d)',    count:lapsed.length,      value:lapsedPotential,   how:'súčet poslednej platby členstva každej klientky'},
        {key:'leads',     label:'Nekontaktované leady (24 h+)',             count:uncontacted.length, value:leadPotential,     how:`počet × konverzia ${conv30??'?'} % × mediánová prvá platba ${medianFirst} €`},
        {key:'upsell',    label:'Kandidátky na členstvo (3+ vstupy/60 d)',  count:upsell.length,      value:upsellPotential,   how:`počet × mediánová cena členstva ${medianMem} €`},
      ]};

    // ── POZORNOSŤ + ODPORÚČANÉ AKCIE ─────────────────────────────────────────
    const attention=[];
    for(const c of cities) if(c.change_pct!=null && c.change_pct<=-15)
      attention.push({icon:'⚠️', text:`${c.city}: návštevnosť za 14 dní klesla o ${Math.abs(c.change_pct)} % (${c.attendance_prev_14d} → ${c.attendance_14d}).`});
    for(const o of nearFull)
      attention.push({icon:'🔝', text:`${o.city} ${o.time} (${o.date}): ${o.booked}/${o.capacity} miest — ${o.pct} % kapacity.`});
    const actions=[];
    if(winback.length)    actions.push(`Spusti winback pre ${winback.length} klientok (potenciál ~${winbackPotential} €).`);
    if(uncontacted.length)actions.push(`Kontaktuj ${uncontacted.length} leadov bez kontaktu 24 h+.`);
    if(expiring.length)   actions.push(`Ponúkni obnovu ${expiring.length} klientkam s končiacim členstvom (~${expiringPotential} €).`);
    if(upsell.length)     actions.push(`Ponúkni mesačné členstvo ${upsell.length} klientkam s opakovanými vstupmi.`);
    for(const c of cities) if(c.change_pct!=null&&c.change_pct<=-15) actions.push(`Analyzuj pokles: ${c.city}.`);

    const data={ generated_at:nowISO(), date:T,
      revenue:rev, members, leads:{...leads, uncontacted_24h:uncontacted.length}, conversion_30d:conv30,
      bookings_today:bookingsToday, cities, occupancy:{near_full:nearFull, all:occupancy.sort((a,b)=>b.pct-a.pct)},
      opportunities:{ winback:{count:winback.length, potential:winbackPotential, list:winback.slice(0,50)},
        expiring:{count:expiring.length, potential:expiringPotential, list:expiring.slice(0,50)},
        uncontacted:{count:uncontacted.length, potential:leadPotential, list:uncontacted.slice(0,50)},
        upsell:{count:upsell.length, potential:upsellPotential, list:upsell.slice(0,50)},
        lapsed:{count:lapsed.length, potential:lapsedPotential, list:lapsed.slice(0,50)} },
      money_left:moneyLeft, attention, actions };
    _cache={at:Date.now(), data};
    return data;
  }

  // ── textový brief z vypočítaných dát ───────────────────────────────────────
  function briefText(d){
    const fmt=n=>(n==null?'—':(Math.round(n*100)/100).toLocaleString('sk-SK'))+' €';
    const pct=(a,b)=>b?Math.round(100*(a-b)/b):null;
    const dYest=pct(d.revenue.yesterday, d.revenue.avg30);
    const L=[];
    L.push('FUSION AI · '+d.date.split('-').reverse().join('. ').replace(/\b0/g,''));
    L.push('');
    L.push(`OBRAT VČERA: ${fmt(d.revenue.yesterday)}${dYest!=null?` (${dYest>=0?'+':''}${dYest} % vs 30-dňový priemer)`:''}`);
    L.push(`OBRAT DNES (zatiaľ): ${fmt(d.revenue.today)} · 7d priemer ${fmt(d.revenue.avg7)} · 30d priemer ${fmt(d.revenue.avg30)}`);
    if(d.revenue.month_forecast!=null) L.push(`MESIAC: ${fmt(d.revenue.month_to_date)} · lineárny odhad konca mesiaca ${fmt(d.revenue.month_forecast)}`);
    L.push('');
    L.push(`NOVÉ LEADY DNES: ${d.leads.new_today} · registrácie: ${d.members.new_today} · nové platiace: ${d.members.new_paying_today}`);
    L.push(`AKTÍVNE ČLENKY: ${d.members.active} · konverzia 30 d: ${d.conversion_30d==null?'—':d.conversion_30d+' %'}`);
    L.push(`DNEŠNÉ REZERVÁCIE: ${d.bookings_today}`);
    if(d.attention.length){ L.push(''); L.push('⚠️ POTREBUJE POZORNOSŤ');
      for(const a of d.attention) L.push('· '+a.text); }
    L.push(''); L.push('🔥 PRÍLEŽITOSTI (odhad spolu '+fmt(d.money_left.total)+')');
    for(const b of d.money_left.breakdown) if(b.count) L.push(`· ${b.label}: ${b.count}${b.value!=null?' (~'+fmt(b.value)+')':''}`);
    if(d.actions.length){ L.push(''); L.push('ODPORÚČANÉ AKCIE');
      d.actions.forEach((a,i)=>L.push((i+1)+'. '+a)); }
    return L.join('\n');
  }

  async function generateBrief(force){
    const d=await compute(force);
    const text=briefText(d);
    const key='fusion_brief_'+d.date;
    const existing=await q.one(db.settings,{key});
    if(existing) await q.update(db.settings,{key},{$set:{value:{text, data:d}, at:nowISO()}});
    else await q.insert(db.settings,{key, value:{text, data:d}, at:nowISO()});
    return {text, data:d};
  }

  // ── endpoints (iba admin) ───────────────────────────────────────────────────
  app.get('/api/admin/fusion-ai/dashboard', adminAuth, async(req,res)=>{
    try{ res.json({ok:true, ...(await compute(req.query.force==='1'))}); }
    catch(e){ res.status(500).json({error:e.message}); }
  });
  app.get('/api/admin/fusion-ai/brief', adminAuth, async(req,res)=>{
    try{
      const key='fusion_brief_'+(req.query.date||today());
      const s=await q.one(db.settings,{key});
      if(s) return res.json({ok:true, ...s.value, stored_at:s.at});
      const b=await generateBrief(false);
      res.json({ok:true, ...b});
    }catch(e){ res.status(500).json({error:e.message}); }
  });
  app.post('/api/admin/fusion-ai/run-brief', adminAuth, async(req,res)=>{
    try{ res.json({ok:true, ...(await generateBrief(true))}); }
    catch(e){ res.status(500).json({error:e.message}); }
  });

  // ── ranný job: brief + notifikácia adminom (hodina konfigurovateľná) ────────
  async function briefHour(){
    const s=await q.one(db.settings,{key:'fusion_ai_config'}).catch(()=>null);
    return Number.isFinite(+s?.value?.brief_hour) ? +s.value.brief_hour : 7;
  }
  async function dailyJob(){
    try{
      const T=today();
      const hour=+new Intl.DateTimeFormat('sv-SE',{timeZone:TZ,hour:'2-digit',hour12:false}).format(new Date());
      if(hour < await briefHour()) return;
      const guard='fusion_brief_sent_'+T;
      if(await q.one(db.settings,{key:guard})) return;
      await q.insert(db.settings,{key:guard, value:true, at:nowISO()});
      const b=await generateBrief(true);
      const admins=(await q.find(db.users,{is_admin:true})).filter(a=>!/@test-fa-qa\.local$/i.test(a.email||''));
      const d=b.data;
      const short=`Obrat včera ${d.revenue.yesterday} € · leady ${d.leads.new_today} · rezervácie ${d.bookings_today} · príležitosti ~${d.money_left.total} €. Otvor Fusion AI v admine.`;
      for(const a of admins) await q.insert(db.notifications,{user_id:a._id, type:'fusion_brief',
        title:'🤖 Fusion AI — ranný brief', body:short, read:false, created_at:nowISO()}).catch(()=>{});
      console.log('🤖 Fusion AI brief vygenerovaný ('+T+')');
    }catch(e){ console.error('fusion-ai daily:', e.message); }
  }
  setInterval(dailyJob, 5*60*1000);
  setTimeout(dailyJob, 20*1000);

  console.log('🤖 Fusion AI (fáza 1) načítaný');
};
