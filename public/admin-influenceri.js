// Admin → Influenceri (24. 9. 2026). Samostatný súbor: pridá položku menu pod
// Ambasádorov, sekciu s tabuľkou (filtre, triedenie, kontakt) a detail influencerky.
// Dáta: GET/PUT /api/admin/influencers (influencer.js).
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const eur=n=>(+n||0).toLocaleString('sk-SK',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
  const cis=n=>(+n||0).toLocaleString('sk-SK');
  const NET={instagram:'IG',tiktok:'TikTok',facebook:'FB',youtube:'YT',iny:'Iné'};
  const STAV_FARBA={novy:'#C9A84C',kontaktovany:'#5aa9e6',spolupracuje:'#4ade80',pozastaveny:'#888'};
  async function j(url,opts={}){
    const r=await fetch(url,{credentials:'include',...opts,headers:{'Content-Type':'application/json'},
      body:opts.body!==undefined?JSON.stringify(opts.body):undefined});
    const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'Chyba'); return d;
  }
  function sietUrl(k,h){
    h=String(h||'').trim(); if(!h) return '';
    if(/\.[a-z]{2,}\//i.test(h)) return 'https://'+h.replace(/^https?:\/\//,'');
    const m=h.replace(/^@/,'');
    return {instagram:'https://instagram.com/'+m, tiktok:'https://www.tiktok.com/@'+m, facebook:'https://facebook.com/'+m,
      youtube:'https://www.youtube.com/@'+m}[k]||'';
  }
  const tel=t=>String(t||'').replace(/[^\d+]/g,'');
  const wa=t=>{ let n=tel(t).replace(/^\+/,''); if(n.startsWith('0')) n='421'+n.slice(1); return 'https://wa.me/'+n; };

  // ── menu + sekcia ──
  function mount(){
    const amb=document.querySelector('.nav-link[onclick*="\'ambasadori\'"]');
    if(amb && !document.querySelector('.nav-link[onclick*="\'influenceri\'"]')){
      const a=document.createElement('a'); a.className='nav-link'; a.href='#';
      a.setAttribute('onclick',"show('influenceri');return false");
      a.innerHTML='<i class="bi bi-megaphone me-2"></i><span style="color:#e0a656;font-weight:700">Influenceri</span> <span id="inflBadge" class="badge ms-1" style="background:#C9A84C;color:#111;display:none"></span>';
      amb.after(a);
    }
    const main=document.querySelector('.main'); if(!main || document.getElementById('s-influenceri')) return;
    const s=document.createElement('div'); s.id='s-influenceri'; s.className='section'; s.style.maxWidth='1300px';
    s.innerHTML=`
    <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
      <div><h4 class="fw-bold mb-0">📣 Influenceri</h4>
        <p class="text-muted small mb-0">Samoregistrácia na <a href="/influencer" target="_blank" class="text-warning">/influencer</a> · odkaz /i/KÓD počíta kliky · provízie, kredit a výplaty idú rovnako ako u ambasádoriek.</p></div>
      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-outline-light" onclick="inflCsv()"><i class="bi bi-download me-1"></i>CSV</button>
        <button class="btn btn-sm btn-outline-light" onclick="loadInfluenceri()"><i class="bi bi-arrow-clockwise me-1"></i>Obnoviť</button>
      </div>
    </div>
    <div id="inflKpi" class="d-flex gap-2 flex-wrap mb-3"></div>
    <div class="card border-0 rounded-3 p-3 mb-3">
      <div class="d-flex gap-2 flex-wrap align-items-end">
        <div style="min-width:200px;flex:1"><label class="text-muted small" for="inflQ">Hľadať</label>
          <input id="inflQ" class="form-control form-control-sm bg-dark text-light border-secondary" placeholder="meno, e-mail, @handle, téma"></div>
        <div><label class="text-muted small" for="inflNet">Sieť</label>
          <select id="inflNet" class="form-select form-select-sm bg-dark text-light border-secondary"><option value="">všetky</option>
          ${Object.entries(NET).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div>
        <div><label class="text-muted small" for="inflStav">Stav</label>
          <select id="inflStav" class="form-select form-select-sm bg-dark text-light border-secondary"><option value="">všetky</option></select></div>
        <div><label class="text-muted small" for="inflMesto">Mesto</label>
          <select id="inflMesto" class="form-select form-select-sm bg-dark text-light border-secondary"><option value="">všetky</option></select></div>
        <div><label class="text-muted small" for="inflMin">Min. sledovateľov</label>
          <input id="inflMin" type="number" min="0" step="1000" class="form-control form-control-sm bg-dark text-light border-secondary" style="width:130px"></div>
        <div class="form-check ms-1 mb-1"><input class="form-check-input" type="checkbox" id="inflPredaj">
          <label class="form-check-label small" for="inflPredaj">len s predajom</label></div>
      </div>
    </div>
    <div class="table-responsive"><table class="table table-dark table-hover table-sm align-middle small" id="inflTbl"></table></div>
    <div id="inflDetail"></div>`;
    main.appendChild(s);
    const css=document.createElement('style');
    css.textContent='#inflTbl td.text-end{white-space:nowrap;font-variant-numeric:tabular-nums}';
    document.head.appendChild(css);
    ['inflQ','inflNet','inflStav','inflMesto','inflMin','inflPredaj'].forEach(id=>
      document.getElementById(id).addEventListener(id==='inflQ'||id==='inflMin'?'input':'change',render));
    const orig=window.show;
    if(typeof orig==='function') window.show=function(sec){ const r=orig.apply(this,arguments); if(sec==='influenceri') loadInfluenceri(); return r; };
    // Odznak nových (čakajú na kontakt) aj bez otvorenia sekcie
    j('/api/admin/influencers').then(d=>{ DATA=d; badge(); }).catch(()=>{});
  }

  let DATA=null, SORT={k:'od',dir:-1};
  function badge(){
    const n=(DATA?.influenceri||[]).filter(x=>!x.test && x.stav==='novy').length;
    const b=document.getElementById('inflBadge'); if(b){ b.textContent=n; b.style.display=n?'':'none'; }
  }
  window.loadInfluenceri=async function(){
    const t=document.getElementById('inflTbl');
    try{ DATA=await j('/api/admin/influencers'); }
    catch(e){ t.innerHTML='<tr><td class="text-danger p-2">Chyba: '+esc(e.message)+'</td></tr>'; return; }
    const st=document.getElementById('inflStav'), ms=document.getElementById('inflMesto');
    const sv=st.value, mv=ms.value;
    st.innerHTML='<option value="">všetky</option>'+Object.entries(DATA.stavy).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
    const mesta=[...new Set(DATA.influenceri.map(x=>x.profil.mesto).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'sk'));
    ms.innerHTML='<option value="">všetky</option>'+mesta.map(m=>`<option>${esc(m)}</option>`).join('');
    st.value=sv; ms.value=mv;
    badge(); render();
  };
  const COLS=[
    ['meno','Influencerka'],['net','Sieť'],['sled','Sledovatelia',1],['mesto','Mesto'],['stav','Stav'],
    ['kliky','Kliky',1],['reg','Registrácie',1],['predaje','Predaje',1],['obrat','Obrat',1],['straty','Straty',1],
    ['kredit','Kredit',1],['od','Od']];
  const val=(x,k)=>({meno:x.meno, net:x.profil.hlavna, sled:x.profil.sledovatelia||0, mesto:x.profil.mesto||'', stav:x.stav,
    kliky:x.cisla.kliky, reg:x.cisla.registracie, predaje:x.cisla.predaje, obrat:x.cisla.obrat, straty:x.cisla.straty,
    kredit:x.cisla.kredit, od:x.od})[k];
  function filtered(){
    const q=document.getElementById('inflQ').value.trim().toLowerCase(), net=document.getElementById('inflNet').value,
      st=document.getElementById('inflStav').value, me=document.getElementById('inflMesto').value,
      min=+document.getElementById('inflMin').value||0, pr=document.getElementById('inflPredaj').checked;
    return (DATA?.influenceri||[]).filter(x=>{
      if(net && !x.profil.siete?.[net]) return false;
      if(st && x.stav!==st) return false;
      if(me && x.profil.mesto!==me) return false;
      if(min && (x.profil.sledovatelia||0)<min) return false;
      if(pr && !x.cisla.predaje) return false;
      if(q){ const h=[x.meno,x.email,x.telefon,x.kod,x.profil.tema,x.profil.mesto,...Object.values(x.profil.siete||{})].join(' ').toLowerCase();
        if(!h.includes(q)) return false; }
      return true;
    });
  }
  function render(){
    const t=document.getElementById('inflTbl'); if(!DATA) return;
    const rows=filtered().sort((a,b)=>{ const A=val(a,SORT.k), B=val(b,SORT.k);
      return (typeof A==='number'? A-B : String(A).localeCompare(String(B),'sk'))*SORT.dir; });
    const sum=k=>rows.reduce((s,x)=>s+(+x.cisla[k]||0),0);
    document.getElementById('inflKpi').innerHTML=[['Influencerky',rows.length],['Kliky',cis(sum('kliky'))],['Registrácie',cis(sum('registracie'))],
      ['Predaje',cis(sum('predaje'))],['Obrat',eur(sum('obrat'))],['Provízie',eur(sum('provizie'))],['Kredit u nich',eur(sum('kredit'))]]
      .map(([l,v])=>`<div class="card border-0 rounded-3 px-3 py-2"><div class="text-muted" style="font-size:.7rem">${l}</div><div class="fw-bold">${v}</div></div>`).join('');
    t.innerHTML='<thead><tr>'+COLS.map(([k,l,num])=>`<th class="${num?'text-end':''}" role="columnheader" aria-sort="${SORT.k===k?(SORT.dir>0?'ascending':'descending'):'none'}" style="cursor:pointer;white-space:nowrap" onclick="inflSort('${k}')">${l}${SORT.k===k?(SORT.dir>0?' ▲':' ▼'):''}</th>`).join('')+'<th>Kontakt</th></tr></thead><tbody>'
      +(rows.length?rows.map(x=>{ const p=x.profil, c=x.cisla, hl=p.siete?.[p.hlavna]||Object.values(p.siete||{})[0]||'';
        return `<tr style="cursor:pointer" onclick="inflDetail('${x.id}')">
        <td><b>${esc(x.meno)}</b>${x.test?' <span class="badge bg-secondary">test</span>':''}<div class="text-muted" style="font-size:.72rem">${esc(hl)}${p.tema?' · '+esc(p.tema):''}</div></td>
        <td>${Object.keys(p.siete||{}).map(k=>`<span class="badge ${k===p.hlavna?'bg-warning text-dark':'bg-secondary'} me-1">${NET[k]||k}</span>`).join('')}</td>
        <td class="text-end">${p.sledovatelia?cis(p.sledovatelia):'—'}</td>
        <td>${esc(p.mesto||'—')}</td>
        <td><span class="badge" style="background:${STAV_FARBA[x.stav]||'#555'};color:#111">${esc(DATA.stavy[x.stav]||x.stav)}</span></td>
        <td class="text-end">${cis(c.kliky)}</td>
        <td class="text-end">${cis(c.registracie)}<div class="text-muted" style="font-size:.68rem">${c.konverzia_klik_reg} %</div></td>
        <td class="text-end fw-bold" style="color:#C9A84C">${cis(c.predaje)}</td>
        <td class="text-end">${eur(c.obrat)}</td>
        <td class="text-end">${cis(c.straty)}</td>
        <td class="text-end">${eur(c.kredit)}</td>
        <td class="text-muted">${esc(x.od)}</td>
        <td onclick="event.stopPropagation()" style="white-space:nowrap">
          ${x.email?`<a class="btn btn-sm btn-outline-light py-0 px-2" title="E-mail" aria-label="E-mail" href="mailto:${esc(x.email)}"><i class="bi bi-envelope"></i></a>`:''}
          ${x.telefon?`<a class="btn btn-sm btn-outline-light py-0 px-2" title="Zavolať" aria-label="Zavolať" href="tel:${esc(tel(x.telefon))}"><i class="bi bi-telephone"></i></a>
          <a class="btn btn-sm btn-outline-success py-0 px-2" title="WhatsApp" aria-label="WhatsApp" target="_blank" rel="noopener" href="${esc(wa(x.telefon))}"><i class="bi bi-whatsapp"></i></a>`:''}
          ${hl&&sietUrl(p.hlavna,hl)?`<a class="btn btn-sm btn-outline-warning py-0 px-2" title="Profil" aria-label="Profil na sieti" target="_blank" rel="noopener" href="${esc(sietUrl(p.hlavna,hl))}"><i class="bi bi-box-arrow-up-right"></i></a>`:''}
        </td></tr>`; }).join('')
      :`<tr><td colspan="${COLS.length+1}" class="text-muted p-3 text-center">${DATA.influenceri.length?'Filtru nezodpovedá nikto.':'Zatiaľ sa nikto neprihlásil. Pošli influencerkám odkaz <b>'+esc(location.origin)+'/influencer</b>.'}</td></tr>`)+'</tbody>';
  }
  window.inflSort=k=>{ SORT = SORT.k===k ? {k,dir:-SORT.dir} : {k,dir:COLS.find(c=>c[0]===k)[2]?-1:1}; render(); };
  window.inflCsv=()=>{
    const rows=filtered(); const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    const csv=[['Meno','E-mail','Telefón','Kód','Stav','Hlavná sieť','Instagram','TikTok','Facebook','YouTube','Sledovatelia','Mesto','Téma','Kliky','Registrácie','Predaje','Obrat','Straty','Provízie','Kredit','Od']]
      .concat(rows.map(x=>[x.meno,x.email,x.telefon,x.kod,DATA.stavy[x.stav]||x.stav,x.profil.hlavna,x.profil.siete?.instagram,x.profil.siete?.tiktok,
        x.profil.siete?.facebook,x.profil.siete?.youtube,x.profil.sledovatelia,x.profil.mesto,x.profil.tema,x.cisla.kliky,x.cisla.registracie,
        x.cisla.predaje,x.cisla.obrat,x.cisla.straty,x.cisla.provizie,x.cisla.kredit,x.od]))
      .map(r=>r.map(q).join(';')).join('\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv'}));
    a.download='influenceri-'+new Date().toISOString().slice(0,10)+'.csv'; a.click();
  };

  // ── detail ──
  window.inflDetail=async function(id){
    const box=document.getElementById('inflDetail');
    box.innerHTML='<div class="text-muted p-3">Načítavam…</div>';
    let d; try{ d=await j('/api/admin/influencers/'+id); }catch(e){ box.innerHTML='<div class="text-danger p-3">'+esc(e.message)+'</div>'; return; }
    const p=d.profil, c=d.cisla, maxK=Math.max(1,...c.dni.map(x=>x.kliky));
    box.innerHTML=`<div class="card border-0 rounded-3 p-3 mt-2" style="border:1px solid #C9A84C55!important">
      <div class="d-flex justify-content-between flex-wrap gap-2">
        <div><h5 class="fw-bold mb-0">${esc(d.meno)}</h5>
          <div class="text-muted small">${esc(d.email)}${d.telefon?' · '+esc(d.telefon):''} · kód <b>${esc(d.kod)}</b> · sadzba ${d.sadzba} % · od ${esc(String(p.at||'').slice(0,10))}</div>
          <div class="mt-1">${Object.entries(p.siete||{}).map(([k,h])=>sietUrl(k,h)?`<a class="badge bg-secondary text-decoration-none me-1" target="_blank" rel="noopener" href="${esc(sietUrl(k,h))}">${NET[k]||k}: ${esc(h)}</a>`:`<span class="badge bg-secondary me-1">${NET[k]||k}: ${esc(h)}</span>`).join('')}
            ${p.sledovatelia?`<span class="badge bg-warning text-dark">${cis(p.sledovatelia)} sledovateľov</span>`:''}</div>
          ${p.tema||p.poznamka?`<div class="small mt-1">${esc(p.tema||'')}${p.poznamka?' — '+esc(p.poznamka):''}</div>`:''}</div>
        <div><button class="btn btn-sm btn-outline-light" onclick="document.getElementById('inflDetail').innerHTML=''">Zavrieť</button></div>
      </div>
      <div class="row g-3 mt-1">
        <div class="col-md-6">
          <div class="text-muted small mb-1">Kliky za 30 dní (${c.kliky_30d}) · zlaté = deň s registráciou</div>
          <div style="display:flex;align-items:flex-end;gap:2px;height:80px;border-bottom:1px solid #333">${c.dni.map(x=>`<div title="${x.den}: ${x.kliky} klikov, ${x.registracie} reg." style="flex:1;min-height:2px;height:${Math.round(x.kliky/maxK*100)}%;background:${x.registracie?'#C9A84C':'#4a4030'};border-radius:2px 2px 0 0"></div>`).join('')}</div>
          <div class="small mt-2">Kliky <b>${c.kliky}</b> (unikátne ${c.kliky_unikatne}) → registrácie <b>${c.registracie}</b> → na hodine <b>${c.na_hodine}</b> → nakúpili <b>${c.zakaznicky}</b> → platia <b>${c.platiace}</b></div>
          <div class="small text-muted">Straty ${c.straty} (${c.straty_bez_nakupu} bez nákupu, ${c.straty_odisli} odišli) · provízie ${eur(c.provizie)}, čaká ${eur(c.caka)}, kredit ${eur(c.kredit)}</div>
          ${c.zdroje.length?`<div class="small text-muted mt-1">Zdroje klikov: ${c.zdroje.map(z=>esc(z.zdroj)+' '+z.pocet).join(', ')}</div>`:''}
          <div class="mt-2 small">Privedení: ${c.ludia.length?c.ludia.map(l=>`<span class="badge bg-dark border border-secondary me-1 mb-1" style="cursor:pointer" onclick="window.otvorProfil?otvorProfil('${l.id}'):null">${esc(l.meno)} · ${esc(l.stav)}</span>`).join(''):'<span class="text-muted">nikto</span>'}</div>
        </div>
        <div class="col-md-6">
          <label class="text-muted small" for="inflDStav">Stav spolupráce</label>
          <select id="inflDStav" class="form-select form-select-sm bg-dark text-light border-secondary mb-2">${Object.entries(DATA?.stavy||{novy:'Nový',kontaktovany:'Kontaktovaný',spolupracuje:'Spolupracuje',pozastaveny:'Pozastavený'}).map(([k,v])=>`<option value="${k}" ${k===(p.stav||'novy')?'selected':''}>${v}</option>`).join('')}</select>
          <label class="text-muted small" for="inflDSled">Sledovatelia (oprava)</label>
          <input id="inflDSled" type="number" min="0" class="form-control form-control-sm bg-dark text-light border-secondary mb-2" value="${p.sledovatelia||0}">
          <label class="text-muted small" for="inflDPozn">Interná poznámka (vidí len admin)</label>
          <textarea id="inflDPozn" rows="3" class="form-control form-control-sm bg-dark text-light border-secondary mb-2">${esc(p.admin_poznamka||'')}</textarea>
          <div class="d-flex gap-2 flex-wrap">
            <button class="btn btn-sm btn-warning" onclick="inflUloz('${d.id}')">Uložiť</button>
            ${d.email?`<a class="btn btn-sm btn-outline-light" href="mailto:${esc(d.email)}?subject=${encodeURIComponent('Spolupráca s Fusion Academy')}" onclick="inflKontakt('${d.id}')"><i class="bi bi-envelope me-1"></i>Napísať</a>`:''}
            ${d.telefon?`<a class="btn btn-sm btn-outline-success" target="_blank" rel="noopener" href="${esc(wa(d.telefon))}" onclick="inflKontakt('${d.id}')"><i class="bi bi-whatsapp me-1"></i>WhatsApp</a>`:''}
            <button class="btn btn-sm btn-outline-light" onclick="navigator.clipboard.writeText('${esc(d.odkaz)}');showToast&&showToast('Odkaz skopírovaný','success')">Kopírovať jej odkaz</button>
          </div>
          ${p.kontaktovana_at?`<div class="text-muted small mt-2">Naposledy kontaktovaná ${esc(p.kontaktovana_at.slice(0,10))}</div>`:''}
        </div>
      </div></div>`;
    box.scrollIntoView({behavior:'smooth',block:'nearest'});
  };
  window.inflUloz=async function(id){
    try{
      const cur=(DATA?.influenceri||[]).find(x=>x.id===id);
      await j('/api/admin/influencers/'+id,{method:'PUT',body:{stav:document.getElementById('inflDStav').value,
        admin_poznamka:document.getElementById('inflDPozn').value,
        profil:{...(cur?.profil||{}), sledovatelia:document.getElementById('inflDSled').value}}});
      window.showToast&&showToast('Uložené','success'); await loadInfluenceri(); inflDetail(id);
    }catch(e){ window.showToast?showToast(e.message,'error'):alert(e.message); }
  };
  window.inflKontakt=function(id){
    const cur=(DATA?.influenceri||[]).find(x=>x.id===id);
    j('/api/admin/influencers/'+id,{method:'PUT',body:{kontaktovana:true, ...(cur&&cur.stav==='novy'?{stav:'kontaktovany'}:{})}})
      .then(()=>loadInfluenceri()).catch(()=>{});
  };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})();
