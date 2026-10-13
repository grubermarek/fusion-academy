/* Preskočenie prvého týždňa zadarmo (Marek 13. 10. 2026).
   V Korytárkach ženy chodili už pred appkou a týždeň zadarmo majú za sebou — keď si teraz
   založia účet, môžu ho vypnúť a za hodiny platiť hneď (vstup, permanentka, členstvo).
   FA_SKIP.mesto(loc) → true pre mestá, kde sa preskočenie ponúka.
   FA_SKIP.potvrd() → Promise<boolean>: upozornenie + POST /api/skuska/preskocit. */
(function(){
  var MESTA = ['korytarky'];
  function bez(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase(); }
  function mesto(loc){ var b=bez(loc); return MESTA.some(function(m){ return b.indexOf(m)>=0; }); }
  function modal(){
    var el=document.getElementById('faSkipModal'); if(el) return el;
    el=document.createElement('div'); el.id='faSkipModal';
    el.style.cssText='position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.72);display:none;align-items:center;justify-content:center;padding:16px';
    el.innerHTML='<div style="background:#1a1612;border:1px solid rgba(201,168,76,.35);border-radius:18px;max-width:400px;width:100%;padding:22px 20px;color:#f3ead8;font-family:inherit;text-align:center">'
      +'<div style="font-size:2rem;margin-bottom:6px">⏭️</div>'
      +'<div style="font-weight:800;font-size:1.08rem;margin-bottom:8px">Prvý týždeň zadarmo už máš za sebou?</div>'
      +'<div style="font-size:.9rem;line-height:1.5;opacity:.85;margin-bottom:16px">Ak si na Zumbu chodila ešte pred appkou, týždeň zadarmo ti vypneme a hodiny zaplatíš rovno — vstupom, permanentkou alebo členstvom. <b>Späť sa už zapnúť nedá.</b></div>'
      +'<div id="faSkipErr" style="display:none;color:#ff8a80;font-size:.85rem;margin-bottom:10px"></div>'
      +'<button id="faSkipOk" style="width:100%;padding:13px;border:0;border-radius:12px;background:#C9A84C;color:#111;font-weight:800;font-size:.95rem;cursor:pointer;margin-bottom:8px">Áno, týždeň som už mala</button>'
      +'<button id="faSkipNo" style="width:100%;padding:12px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:transparent;color:inherit;font-size:.9rem;cursor:pointer">Nie, chcem týždeň zadarmo</button>'
      +'</div>';
    document.body.appendChild(el); return el;
  }
  function potvrd(){
    return new Promise(function(resolve){
      var el=modal(), ok=el.querySelector('#faSkipOk'), no=el.querySelector('#faSkipNo'), err=el.querySelector('#faSkipErr');
      err.style.display='none'; ok.disabled=false; ok.textContent='Áno, týždeň som už mala';
      el.style.display='flex';
      function zavri(v){ el.style.display='none'; ok.onclick=no.onclick=el.onclick=null; resolve(v); }
      no.onclick=function(){ zavri(false); };
      el.onclick=function(e){ if(e.target===el) zavri(false); };
      ok.onclick=async function(){
        ok.disabled=true; ok.textContent='Vypínam…';
        try{
          var r=await fetch('/api/skuska/preskocit',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:'{}'});
          var d=await r.json().catch(function(){ return {}; });
          if(!r.ok){ err.textContent=d.error||'Nepodarilo sa to, skús znova.'; err.style.display='block'; ok.disabled=false; ok.textContent='Áno, týždeň som už mala'; return; }
          zavri(true);
        }catch(e){ err.textContent='Chyba pripojenia. Skús znova.'; err.style.display='block'; ok.disabled=false; ok.textContent='Áno, týždeň som už mala'; }
      };
    });
  }
  window.FA_SKIP={ mesto:mesto, potvrd:potvrd };
})();
