/**
 * Fusion Academy – vždy viditeľný spodný dock
 * Include: <script src="/dock.js"></script>
 * Rýchly prístup: Domov · Rezervovať · Komunita · Profil
 * (Natívny HTML/CSS/JS ekvivalent „tilted-dock" konceptu — bez React/framer.)
 */
(function(){
'use strict';
if (window.__faDock) return; window.__faDock = true;

const ICON = {
  home:'<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  calendar:'<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/>',
  users:'<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 3-6 6.5-6s6.5 2.4 6.5 6"/><path d="M17 5.2a3.2 3.2 0 0 1 0 5.9M22 20c0-2.6-1.4-4.6-3.6-5.5"/>',
  user:'<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c0-3.9 3.3-6.5 7.5-6.5s7.5 2.6 7.5 6.5"/>',
};
function svg(name){
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">${ICON[name]}</svg>`;
}

const items = [
  { key:'home',  label:'Domov',      icon:'home',     href:'/client-dashboard', match:['/client-dashboard','/dashboard'] },
  { key:'book',  label:'Rezervovať', icon:'calendar', href:'/client-dashboard#bookSection', match:['#book'] },
  { key:'comm',  label:'Komunita',   icon:'users',    href:'/community', match:['/community'] },
  { key:'prof',  label:'Profil',     icon:'user',     href:'/u/', match:['/u/'] },
];

const css = `
#fa-dock{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:600;
  display:flex;gap:6px;padding:8px 10px;border-radius:26px;
  background:rgba(18,16,14,.82);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
  border:1px solid rgba(201,162,76,.22);
  box-shadow:0 12px 34px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.05);
  font-family:'Manrope',system-ui,sans-serif;max-width:calc(100vw - 24px);}
#fa-dock a{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:2px;text-decoration:none;color:rgba(234,227,213,.6);
  width:56px;height:50px;border-radius:18px;transition:all .18s ease;}
#fa-dock a:hover{color:#EAE3D5;background:rgba(255,255,255,.06);transform:translateY(-2px);}
#fa-dock a.fa-dock-active{color:#C9A24C;background:rgba(201,162,76,.14);}
#fa-dock a svg{transition:transform .18s ease}
#fa-dock a:hover svg{transform:scale(1.12)}
#fa-dock .fa-dock-lbl{font-size:.6rem;font-weight:700;letter-spacing:.02em;opacity:0;max-height:0;transition:all .18s ease;}
#fa-dock a.fa-dock-active .fa-dock-lbl{opacity:1;max-height:14px;}
@media(max-width:420px){#fa-dock a{width:52px}}
/* Uvoľni priestor, aby dock neprekrýval obsah stránky */
body.fa-has-dock{padding-bottom:86px;}
`;

function currentKey(){
  const p = location.pathname;
  if (p.startsWith('/u/')) return 'prof';
  if (p.startsWith('/community')) return 'comm';
  if (p.startsWith('/client-dashboard')||p.startsWith('/dashboard')) return 'home';
  return '';
}

async function build(){
  // Zisti moje id pre link na profil
  let myId = '';
  try { const me = await (await fetch('/api/me',{credentials:'include'})).json(); myId = me && me.id ? me.id : ''; } catch(e){}
  // Ak nie je prihlásený, dock nezobrazuj
  if (!myId) return;

  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const active = currentKey();
  const dock = document.createElement('nav'); dock.id = 'fa-dock'; dock.setAttribute('aria-label','Rýchla navigácia');
  dock.innerHTML = items.map(it=>{
    const href = it.key==='prof' ? ('/u/'+myId) : it.href;
    const isActive = it.key===active;
    return `<a href="${href}" class="${isActive?'fa-dock-active':''}" title="${it.label}" aria-label="${it.label}">
      ${svg(it.icon)}<span class="fa-dock-lbl">${it.label}</span></a>`;
  }).join('');
  document.body.appendChild(dock);
  document.body.classList.add('fa-has-dock');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
else build();
})();
