// Admin → Fusion X (2. 10. 2026). Samostatný súbor: položka menu pod Influencermi/Ambasádormi,
// žiadosti partnerov z webu, schválenie + verejný profil a ručné pridanie partnera.
// Dáta: /api/admin/fusion-x (fusion-x.js). Partner sa zverejní LEN stavom „schvaleny".
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cis=n=>(+n||0).toLocaleString('sk-SK');
  const dt=d=>d?new Date(d).toLocaleDateString('sk-SK'):'—';
  const FARBA={novy:'#C9A84C',v_rieseni:'#5aa9e6',schvaleny:'#4ade80',pozastaveny:'#888',zamietnuty:'#f87171'};
  const inp='form-control form-control-sm bg-dark text-light border-secondary';
  async function j(url,opts={}){
    const r=await fetch(url,{credentials:'include',...opts,headers:{'Content-Type':'application/json'},
      body:opts.body!==undefined?JSON.stringify(opts.body):undefined});
    const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'Chyba'); return d;
  }
  const toast=(m,t)=>window.showToast?showToast(m,t||'success'):alert(m);

  function mount(){
    const kotva=document.querySelector('.nav-link[onclick*="\'influenceri\'"]')||document.querySelector('.nav-link[onclick*="\'ambasadori\'"]');
    if(kotva && !document.querySelector('.nav-link[onclick*="\'fusionx\'"]')){
      const a=document.createElement('a'); a.className='nav-link'; a.href='#';
      a.setAttribute('onclick',"show('fusionx');return false");
      a.innerHTML='<i class="bi bi-tags me-2"></i><span style="color:#e0a656;font-weight:700">Fusion X</span> <span id="fxBadge" class="badge ms-1" style="background:#C9A84C;color:#111;display:none"></span>';
      kotva.after(a);
    }
    const main=document.querySelector('.main'); if(!main || document.getElementById('s-fusionx')) return;
    const s=document.createElement('div'); s.id='s-fusionx'; s.className='section'; s.style.maxWidth='1200px';
    s.innerHTML=`
    <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
      <div><h4 class="fw-bold mb-0">🏷️ Fusion X — partneri</h4>
        <p class="text-muted small mb-0">Žiadosti prichádzajú z formulára na webe. Partner sa nezverejní sám — po dohode doplň profil a daj <b>Schváliť a zverejniť</b>. Členovia ho potom vidia v appke (<a href="/fusion-x" target="_blank" class="text-warning">/fusion-x</a>) aj na webe.</p></div>
      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-warning" onclick="fxNovy()"><i class="bi bi-plus-lg me-1"></i>Pridať partnera</button>
        <button class="btn btn-sm btn-outline-light" onclick="loadFusionX()"><i class="bi bi-arrow-clockwise me-1"></i>Obnoviť</button>
      </div>
    </div>
    <div id="fxKpi" class="d-flex gap-2 flex-wrap mb-3"></div>
    <div class="d-flex gap-2 flex-wrap align-items-end mb-2">
      <div><label class="text-muted small" for="fxStav">Stav</label>
        <select id="fxStav" class="form-select form-select-sm bg-dark text-light border-secondary"><option value="">všetky okrem zamietnutých</option></select></div>
      <div style="min-width:200px;flex:1"><label class="text-muted small" for="fxQ">Hľadať</label>
        <input id="fxQ" class="${inp}" placeholder="firma, mesto, kontakt"></div>
    </div>
    <div class="table-responsive"><table class="table table-dark table-hover table-sm align-middle small" id="fxTbl"></table></div>
    <div id="fxDetail"></div>`;
    main.appendChild(s);
    document.getElementById('fxStav').addEventListener('change',render);
    document.getElementById('fxQ').addEventListener('input',render);
    const orig=window.show;
    if(typeof orig==='function') window.show=function(sec){ const r=orig.apply(this,arguments); if(sec==='fusionx') loadFusionX(); return r; };
    j('/api/admin/fusion-x').then(d=>{ DATA=d; badge(); }).catch(()=>{});
  }

  let DATA=null;
  function badge(){
    const n=(DATA?.partneri||[]).filter(p=>p.stav==='novy').length;
    const b=document.getElementById('fxBadge'); if(b){ b.textContent=n; b.style.display=n?'':'none'; }
  }
  window.loadFusionX=async function(){
    try{ DATA=await j('/api/admin/fusion-x'); }catch(e){ document.getElementById('fxTbl').innerHTML='<tr><td class="text-danger">'+esc(e.message)+'</td></tr>'; return; }
    const sel=document.getElementById('fxStav'), v=sel.value;
    sel.innerHTML='<option value="">všetky okrem zamietnutých</option>'+Object.entries(DATA.stavy).map(([k,l])=>`<option value="${k}">${esc(l)}</option>`).join('');
    sel.value=v; badge(); render();
  };
  function render(){
    if(!DATA) return;
    const P=DATA.partneri;
    const kpi=[['Nové žiadosti',P.filter(p=>p.stav==='novy').length],['V riešení',P.filter(p=>p.stav==='v_rieseni').length],['Zverejnení partneri',P.filter(p=>p.stav==='schvaleny').length]];
    document.getElementById('fxKpi').innerHTML=kpi.map(([l,v])=>`<div class="card border-0 rounded-3 px-3 py-2"><div class="text-muted" style="font-size:.7rem">${l}</div><div class="fw-bold">${v}</div></div>`).join('')
      +'<div class="text-muted align-self-center" style="font-size:.72rem;max-width:380px">Partner nič neskenuje — členka mu ukáže kartu Fusion X v appke (meno, aktívne členstvo, platnosť) a on dá 10 % zľavu.</div>';
    const st=document.getElementById('fxStav').value, q=document.getElementById('fxQ').value.trim().toLowerCase();
    const rows=P.filter(p=>(st?p.stav===st:p.stav!=='zamietnuty') && (!q || [p.firma,p.mesto,p.kontakt_meno,p.email,p.kategoria].join(' ').toLowerCase().includes(q)));
    document.getElementById('fxTbl').innerHTML='<thead><tr><th>Firma</th><th>Mesto · kategória</th><th>Kontakt</th><th>Stav</th><th>Prišla</th></tr></thead><tbody>'
      +(rows.length?rows.map(p=>`<tr style="cursor:pointer" onclick="fxDetail('${p._id}')">
        <td><b>${esc(p.profil?.nazov||p.firma)}</b>${p.spam?' <span class="badge bg-secondary">spam?</span>':''}${p.zdroj==='admin'?' <span class="badge bg-secondary">ručne</span>':''}</td>
        <td>${esc(p.mesto)}<div class="text-muted" style="font-size:.72rem">${esc(p.kategoria)}</div></td>
        <td>${esc(p.kontakt_meno||'—')}<div class="text-muted" style="font-size:.72rem">${esc(p.telefon||'')} ${esc(p.email||'')}</div></td>
        <td><span class="badge" style="background:${FARBA[p.stav]||'#555'};color:#111">${esc(DATA.stavy[p.stav]||p.stav)}</span></td>
        <td class="text-muted">${dt(p.created_at)}</td></tr>`).join('')
      :`<tr><td colspan="5" class="text-muted p-3 text-center">${P.length?'Filtru nezodpovedá nikto.':'Zatiaľ žiadna žiadosť. Formulár „Staň sa partnerom Fusion X" je na webe fusionacademy.sk/fusion-x.'}</td></tr>`)+'</tbody>';
  }

  const pole=(id,label,val,typ)=>`<div class="col-md-6 mb-2"><label class="text-muted small" for="${id}">${label}</label>${typ==='area'
    ?`<textarea id="${id}" rows="3" class="${inp}">${esc(val)}</textarea>`:`<input id="${id}" class="${inp}" value="${esc(val)}">`}</div>`;
  window.fxDetail=function(id){
    const p=DATA.partneri.find(x=>x._id===id); if(!p) return;
    const f=p.profil||{}, box=document.getElementById('fxDetail');
    const tel=String(p.telefon||'').replace(/[^\d+]/g,'');
    box.innerHTML=`<div class="card border-0 rounded-3 p-3 mt-2" style="border:1px solid #C9A84C55!important">
      <div class="d-flex justify-content-between flex-wrap gap-2 mb-2">
        <div><h5 class="fw-bold mb-0">${esc(p.firma)}</h5>
          <div class="text-muted small">${esc(DATA.stavy[p.stav]||p.stav)} · prišla ${dt(p.created_at)}${p.schvaleny_at?' · zverejnený '+dt(p.schvaleny_at):''}${p.spam_dovody?' · podozrenie na spam: '+esc(p.spam_dovody.join(', ')):''}</div></div>
        <button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById('fxDetail').innerHTML=''" aria-label="Zavrieť">✕</button>
      </div>
      <div class="row g-3">
        <div class="col-lg-5"><div class="p-2 rounded" style="background:#111">
          <div class="text-warning small fw-bold mb-1">Žiadosť (interné, nezverejňuje sa)</div>
          <div class="small"><b>Kontakt:</b> ${esc(p.kontakt_meno||'—')}<br>
          ${tel?`<b>Telefón:</b> <a class="text-warning" href="tel:${esc(tel)}">${esc(p.telefon)}</a><br>`:''}
          ${p.email?`<b>E-mail:</b> <a class="text-warning" href="mailto:${esc(p.email)}">${esc(p.email)}</a><br>`:''}
          ${p.web?`<b>Web / siete:</b> <a class="text-warning" target="_blank" rel="noopener" href="${esc(p.web)}">${esc(p.web)}</a><br>`:''}
          <b>Mesto:</b> ${esc(p.mesto)} · <b>Kategória:</b> ${esc(p.kategoria)}<br>
          <b>Ponuka:</b> ${esc(p.opis||'—').replace(/\n/g,'<br>')}<br>
          <b>Zľava ${DATA.zlava} % na všetko:</b> ${p.suhlas_zlava?'✅ potvrdená':'—'}</div>
          <label class="text-muted small mt-2" for="fxPozn">Interná poznámka (dohoda, kedy volať…)</label>
          <textarea id="fxPozn" rows="3" class="${inp}">${esc(p.poznamka||'')}</textarea>
        </div></div>
        <div class="col-lg-7">
          <div class="text-warning small fw-bold mb-1">Verejný profil (uvidia ho členovia a web)</div>
          <div class="row">
            ${pole('fxNazov','Názov *',f.nazov||p.firma)}${pole('fxMesto','Mesto *',f.mesto||p.mesto)}
            <div class="col-md-6 mb-2"><label class="text-muted small" for="fxKat">Kategória</label>
              <select id="fxKat" class="form-select form-select-sm bg-dark text-light border-secondary">${[...new Set([...(DATA.kategorie||[]),f.kategoria||p.kategoria].filter(Boolean))].map(k=>`<option ${k===(f.kategoria||p.kategoria)?'selected':''}>${esc(k)}</option>`).join('')}</select></div>
            ${pole('fxAdresa','Adresa',f.adresa)}${pole('fxTel','Verejný telefón',f.telefon)}${pole('fxWeb','Web',f.web)}
            ${pole('fxLogo','Logo (odkaz https:// alebo /cesta)',f.logo)}${pole('fxPoradie','Poradie (menšie = vyššie)',f.poradie||0)}
            ${pole('fxPopis','Krátky popis pre členov',f.popis,'area')}${pole('fxUplat','Ako uplatniť (nepovinné)',f.uplatnenie,'area')}
          </div>
          <div class="text-muted" style="font-size:.72rem">Zľava je pre všetkých partnerov rovnaká: ${DATA.zlava} % na všetky produkty a služby.</div>
        </div>
      </div>
      <div class="d-flex gap-2 flex-wrap mt-3">
        <button class="btn btn-sm btn-outline-light" onclick="fxUloz('${p._id}')">Uložiť</button>
        ${p.stav!=='schvaleny'?`<button class="btn btn-sm btn-success" onclick="fxUloz('${p._id}','schvaleny')"><i class="bi bi-check-lg me-1"></i>Schváliť a zverejniť</button>`:''}
        ${p.stav==='novy'?`<button class="btn btn-sm btn-outline-info" onclick="fxUloz('${p._id}','v_rieseni')">Označiť: v riešení</button>`:''}
        ${p.stav==='schvaleny'?`<button class="btn btn-sm btn-outline-warning" onclick="fxUloz('${p._id}','pozastaveny')">Pozastaviť (skryť)</button>`:''}
        ${!['zamietnuty','schvaleny'].includes(p.stav)?`<button class="btn btn-sm btn-outline-danger" onclick="fxUloz('${p._id}','zamietnuty')">Zamietnuť</button>`:''}
        ${p.stav!=='schvaleny'?`<button class="btn btn-sm btn-outline-secondary ms-auto" onclick="fxZmaz('${p._id}')"><i class="bi bi-trash me-1"></i>Zmazať</button>`:''}
      </div></div>`;
    box.scrollIntoView({behavior:'smooth',block:'start'});
  };
  const v=id=>document.getElementById(id)?.value??'';
  window.fxUloz=async function(id,stav){
    const body={ poznamka:v('fxPozn'), profil:{ nazov:v('fxNazov'), mesto:v('fxMesto'), kategoria:v('fxKat'), adresa:v('fxAdresa'),
      telefon:v('fxTel'), web:v('fxWeb'), logo:v('fxLogo'), poradie:v('fxPoradie'), popis:v('fxPopis'), uplatnenie:v('fxUplat') } };
    if(stav) body.stav=stav;
    if(stav==='schvaleny' && !confirm('Zverejniť partnera? Uvidia ho členovia v appke aj návštevníci webu. Aktívni členovia dostanú oznam, ak je to prvý partner.')) return;
    try{ await j('/api/admin/fusion-x/partneri/'+id,{method:'PUT',body}); toast(stav==='schvaleny'?'Partner je zverejnený':'Uložené'); await loadFusionX(); fxDetail(id); }
    catch(e){ toast(e.message,'error'); }
  };
  window.fxZmaz=async function(id){
    if(!confirm('Natrvalo zmazať tento záznam?')) return;
    try{ await j('/api/admin/fusion-x/partneri/'+id,{method:'DELETE'}); document.getElementById('fxDetail').innerHTML=''; await loadFusionX(); toast('Zmazané'); }
    catch(e){ toast(e.message,'error'); }
  };
  window.fxNovy=async function(){
    const firma=prompt('Názov firmy partnera:'); if(!firma) return;
    const mesto=prompt('Mesto:')||'';
    try{ const d=await j('/api/admin/fusion-x/partneri',{method:'POST',body:{firma,mesto,kategoria:(DATA?.kategorie||[])[0]||''}}); await loadFusionX(); fxDetail(d.id); }
    catch(e){ toast(e.message,'error'); }
  };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})();
