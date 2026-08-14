/* ═══════════════════════════════════════════════════════════════════════════
   BOOKING SUCCESS POP-UP — „Si prihlásená! Vezmi aj kamošku 🎁"
   Zdieľaný medzi client-dashboard.html a schedule.html.
   Použitie: showBookingSuccess({className, dateStr})
   - konfety (vypnuté pri prefers-reduced-motion)
   - jednotný pozývací text z /api/invite-message + tlačidlo Skopírovať/Zdieľať
   - promo: nová kamoška získava športovú tašku ZDARMA — do konca mesiaca
   - živý odpočet dní/hodín/minút do konca mesiaca
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
if(window.showBookingSuccess) return;

const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── štýly (raz) ── */
function injectCss(){
  if(document.getElementById('bsPopCss')) return;
  const s=document.createElement('style'); s.id='bsPopCss';
  s.textContent=`
  .bs-backdrop{position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,.62);backdrop-filter:blur(4px);
    display:flex;align-items:center;justify-content:center;padding:18px;opacity:0;transition:opacity .22s ease-out}
  .bs-backdrop.show{opacity:1}
  .bs-card{position:relative;width:100%;max-width:420px;max-height:calc(100dvh - 36px);overflow-y:auto;
    background:linear-gradient(168deg,#1d1d22,#141416);border:1px solid rgba(255,255,255,.09);border-radius:22px;
    padding:26px 20px 20px;text-align:center;color:#eee;box-shadow:0 24px 70px rgba(0,0,0,.55);
    transform:translateY(16px) scale(.96);opacity:0;transition:transform .28s cubic-bezier(.2,.9,.3,1.15),opacity .22s ease-out}
  .bs-backdrop.show .bs-card{transform:translateY(0) scale(1);opacity:1}
  .bs-close{position:absolute;top:10px;right:10px;width:40px;height:40px;border:0;border-radius:50%;
    background:rgba(255,255,255,.07);color:#bbb;font-size:1.05rem;cursor:pointer;line-height:1}
  .bs-check{width:74px;height:74px;margin:0 auto 12px;border-radius:50%;
    background:radial-gradient(circle at 32% 28%,#57d98a,#1e9e57);display:flex;align-items:center;justify-content:center;
    box-shadow:0 0 0 8px rgba(87,217,138,.14),0 0 34px rgba(87,217,138,.35)}
  .bs-check svg{width:38px;height:38px}
  .bs-check svg path{stroke:#fff;stroke-width:3.4;fill:none;stroke-linecap:round;stroke-linejoin:round}
  @media (prefers-reduced-motion: no-preference){
    .bs-check{animation:bsPop .5s cubic-bezier(.2,1.4,.4,1) both .08s}
    .bs-check svg path{stroke-dasharray:34;stroke-dashoffset:34;animation:bsDraw .45s ease-out forwards .3s}
    .bs-gift{animation:bsWiggle 2.6s ease-in-out infinite 1s}
  }
  @keyframes bsPop{from{transform:scale(.3);opacity:0}to{transform:scale(1);opacity:1}}
  @keyframes bsDraw{to{stroke-dashoffset:0}}
  @keyframes bsWiggle{0%,86%,100%{transform:rotate(0)}90%{transform:rotate(-9deg)}94%{transform:rotate(8deg)}98%{transform:rotate(-4deg)}}
  .bs-title{font-size:1.32rem;font-weight:800;color:#fff;margin:0 0 3px}
  .bs-sub{font-size:.86rem;color:#9c9ca4;margin:0 0 16px;line-height:1.45}
  .bs-promo{background:linear-gradient(150deg,rgba(201,168,76,.16),rgba(201,168,76,.05));
    border:1px solid rgba(201,168,76,.45);border-radius:16px;padding:15px 14px 13px;margin:0 0 12px}
  .bs-gift{font-size:2rem;line-height:1;display:inline-block}
  .bs-promo-t{font-size:1.02rem;font-weight:800;color:#e8cf8a;margin:7px 0 4px}
  .bs-promo-s{font-size:.83rem;color:#cfcabd;line-height:1.5;margin:0 0 11px}
  .bs-count-label{font-size:.72rem;font-weight:700;letter-spacing:.06em;color:#ff9f9f;text-transform:uppercase;margin-bottom:6px}
  .bs-count{display:flex;justify-content:center;gap:7px}
  .bs-cell{min-width:56px;background:rgba(224,86,86,.13);border:1px solid rgba(224,86,86,.45);border-radius:11px;padding:7px 6px 6px}
  .bs-cell b{display:block;font-size:1.28rem;font-weight:800;color:#ffb3b3;font-variant-numeric:tabular-nums;line-height:1.1}
  .bs-cell span{font-size:.62rem;font-weight:700;letter-spacing:.05em;color:#c98d8d;text-transform:uppercase}
  .bs-btn{width:100%;min-height:50px;border:0;border-radius:14px;font-size:.98rem;font-weight:800;cursor:pointer;
    display:flex;align-items:center;justify-content:center;gap:8px;transition:transform .15s ease,filter .15s ease;touch-action:manipulation}
  .bs-btn:active{transform:scale(.97)}
  .bs-btn-gold{background:linear-gradient(135deg,#C9A84C,#a5842f);color:#17130a;margin-bottom:9px}
  .bs-btn-gold.copied{background:linear-gradient(135deg,#57d98a,#1e9e57);color:#fff}
  .bs-btn-ghost{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#bbb;min-height:44px;font-size:.86rem;font-weight:600}
  .bs-conf{position:absolute;top:-6px;width:9px;height:14px;border-radius:2px;opacity:.95;pointer-events:none;
    animation:bsFall var(--d) ease-in var(--dl) forwards}
  @keyframes bsFall{
    0%{transform:translateY(-10px) rotate(0);opacity:1}
    85%{opacity:1}
    100%{transform:translateY(108vh) rotate(var(--r));opacity:0}
  }`;
  document.head.appendChild(s);
}

/* ── konfety ── */
function confetti(host){
  if(REDUCED) return;
  const COLORS=['#C9A84C','#e94560','#57d98a','#7ec8e3','#f5f0e6','#ff9f43'];
  for(let i=0;i<46;i++){
    const c=document.createElement('i'); c.className='bs-conf';
    c.style.left=(Math.random()*100)+'%';
    c.style.background=COLORS[i%COLORS.length];
    c.style.setProperty('--d',(2.1+Math.random()*1.6)+'s');
    c.style.setProperty('--dl',(Math.random()*0.7)+'s');
    c.style.setProperty('--r',(Math.random()>.5?'':'-')+(420+Math.random()*400)+'deg');
    if(Math.random()>.6){ c.style.width='8px'; c.style.height='8px'; c.style.borderRadius='50%'; }
    host.appendChild(c);
  }
}

/* ── odpočet do konca mesiaca ── */
function endOfMonth(){ const n=new Date(); return new Date(n.getFullYear(), n.getMonth()+1, 1, 0, 0, 0); }
function tick(el){
  if(!el || !el.isConnected) return;
  let ms=endOfMonth()-new Date(); if(ms<0) ms=0;
  const d=Math.floor(ms/86400000), h=Math.floor(ms/3600000)%24, m=Math.floor(ms/60000)%60, s=Math.floor(ms/1000)%60;
  const cells=[[d,d===1?'deň':(d>=2&&d<=4?'dni':'dní')],[h,'hod'],[m,'min'],[s,'sek']];
  el.innerHTML=cells.map(c=>`<div class="bs-cell"><b>${String(c[0]).padStart(2,'0')}</b><span>${c[1]}</span></div>`).join('');
  setTimeout(()=>tick(el),1000);
}

/* ── jednotná pozvánka (rovnaký zdroj ako inviteFriend v dashboarde) ── */
async function inviteMsg(){
  try{
    const r=await fetch('/api/invite-message',{credentials:'include'});
    const d=await r.json(); if(d?.ok && d.message) return d;
  }catch(e){}
  try{
    const r=await fetch('/api/me',{credentials:'include'}); const me=await r.json();
    const code=me?.referral_code||'';
    return {message:'Poď so mnou na Zumbu! 💃❤️\nPrvú hodinu máš úplne ZADARMO.\nVyber si, kde a kedy chceš prísť 👇\n'+location.origin+'/invite/'+code};
  }catch(e){ return {message:'Poď so mnou na Zumbu! 💃❤️ '+location.origin}; }
}
const MONTH_GEN=['januára','februára','marca','apríla','mája','júna','júla','augusta','septembra','októbra','novembra','decembra'];
function promoLine(){
  // Kamoška má prvú hodinu zadarmo (to už hovorí samotná pozvánka) — pripomenieme to.
  return `\n\nPrvú hodinu máš u nás ZADARMO — len príď! 😍`;
}

/* ── verejné API ── */
window.showBookingSuccess=async function(opts){
  opts=opts||{};
  injectCss();
  document.getElementById('bsPop')?.remove();
  const inv=await inviteMsg();
  const fullMsg=inv.message+promoLine();
  const lastDay=new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate();
  const monthGen=MONTH_GEN[new Date().getMonth()];

  const bd=document.createElement('div'); bd.className='bs-backdrop'; bd.id='bsPop';
  bd.innerHTML=`
    <div class="bs-card" role="dialog" aria-modal="true" aria-label="Rezervácia potvrdená">
      <button class="bs-close" aria-label="Zavrieť" onclick="this.closest('.bs-backdrop').remove()">✕</button>
      <div class="bs-check"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 17 l6.5 6.5 L25.5 9.5"/></svg></div>
      <h3 class="bs-title">Si prihlásená! 🎉</h3>
      <p class="bs-sub">${opts.className?`<b style="color:#ddd">${String(opts.className).replace(/</g,'&lt;')}</b>${opts.dateStr?' · '+String(opts.dateStr).replace(/</g,'&lt;'):''}<br>`:''}Vidíme sa na hodine — a vieš čo je ešte lepšie? Tancovať s kamoškou! 💃💃</p>
      <div class="bs-promo">
        <span class="bs-gift" aria-hidden="true">🎁</span>
        <div class="bs-promo-t">Vezmi kamošku — a športová taška je TVOJA!</div>
        <p class="bs-promo-s">Keď sa <b>nová kamoška</b> pridá k nám cez tvoj odkaz, <b style="color:#e8cf8a">ty získavaš športovú tašku ZDARMA</b> — a ona má <b>prvú hodinu zadarmo</b>. Akcia platí už len do <b>${lastDay}. ${monthGen}</b>!</p>
        <div class="bs-count-label">🔥 Do konca akcie zostáva</div>
        <div class="bs-count" id="bsCount" aria-live="off"></div>
      </div>
      <button class="bs-btn bs-btn-gold" id="bsCopyBtn">💌 Skopírovať pozvánku s mojím linkom</button>
      <button class="bs-btn bs-btn-ghost" onclick="this.closest('.bs-backdrop').remove()">Zavriem, idem tancovať 💪</button>
    </div>`;
  document.body.appendChild(bd);
  requestAnimationFrame(()=>bd.classList.add('show'));
  confetti(bd.querySelector('.bs-card'));
  tick(document.getElementById('bsCount'));

  bd.addEventListener('click',e=>{ if(e.target===bd) bd.remove(); });

  const btn=document.getElementById('bsCopyBtn');
  btn.onclick=async()=>{
    // Mobil: natívne zdieľanie (WhatsApp/Messenger); inak clipboard
    if(navigator.share){ try{ await navigator.share({text:fullMsg}); return; }catch(e){ if(e.name==='AbortError') return; } }
    try{ await navigator.clipboard.writeText(fullMsg); }
    catch(e){ const t=document.createElement('textarea'); t.value=fullMsg; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    btn.classList.add('copied'); btn.textContent='✓ Skopírované — pošli ju kamoške!';
    setTimeout(()=>{ btn.classList.remove('copied'); btn.textContent='💌 Skopírovať pozvánku s mojím linkom'; },2600);
  };
};
})();
