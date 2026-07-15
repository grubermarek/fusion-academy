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
  swap:'<path d="M7 4 3 8l4 4"/><path d="M3 8h13a4 4 0 0 1 4 4"/><path d="M17 20l4-4-4-4"/><path d="M21 16H8a4 4 0 0 1-4-4"/>',
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
#fa-dock button.fa-dock-item{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:none;border:none;cursor:pointer;color:rgba(234,227,213,.6);width:56px;height:50px;border-radius:18px;transition:all .18s ease;font-family:'Manrope';}
#fa-dock button.fa-dock-item:hover{color:#EAE3D5;background:rgba(255,255,255,.06);transform:translateY(-2px);}
#fa-dock button.fa-dock-item svg{transition:transform .18s}
#fa-dock button.fa-dock-item:hover svg{transform:scale(1.12)}
#fa-dock .fa-dock-lbl-s{font-size:.6rem;font-weight:700;opacity:0;max-height:0;transition:all .18s}
#fa-dock button.fa-dock-item:hover .fa-dock-lbl-s{opacity:1;max-height:14px}
#fa-role-menu{position:fixed;left:50%;transform:translateX(-50%);z-index:601;background:rgba(22,20,17,.97);backdrop-filter:blur(16px);border:1px solid rgba(201,162,76,.35);border-radius:16px;padding:6px;box-shadow:0 14px 40px rgba(0,0,0,.6);min-width:210px;display:none;font-family:'Manrope';}
#fa-role-menu.on{display:block}
#fa-role-menu a{display:flex;align-items:center;gap:11px;padding:11px 14px;border-radius:11px;text-decoration:none;color:#EAE3D5;font-size:.9rem;transition:.14s}
#fa-role-menu a:hover{background:rgba(201,162,76,.14);color:#C9A24C}
#fa-role-menu a .rm-i{font-size:1.15rem}
#fa-role-menu a.cur{background:rgba(201,162,76,.1);color:#C9A24C}
#fa-role-menu .rm-hd{font-size:.66rem;text-transform:uppercase;letter-spacing:.1em;color:rgba(234,227,213,.4);padding:8px 14px 4px;font-weight:700}
@media(max-width:420px){#fa-dock a,#fa-dock button.fa-dock-item{width:50px}}
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
  let me = null;
  try { me = await (await fetch('/api/me',{credentials:'include'})).json(); } catch(e){}
  const myId = me && me.id ? me.id : '';
  if (!myId) return; // neprihlásený → bez docku

  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const active = currentKey();
  const dock = document.createElement('nav'); dock.id = 'fa-dock'; dock.setAttribute('aria-label','Rýchla navigácia');

  // Dostupné role/dashboardy (prepínanie na jednom mieste)
  const roles = [{ key:'client', label:'Osobný', icon:'🏠', href:'/client-dashboard' }];
  if (me.is_admin) roles.push({ key:'admin', label:'Firemný', icon:'💼', href:'/admin' });
  if (me.is_admin || me.user_type==='trainer' || me.user_type==='manager') roles.push({ key:'trainer', label:'Trénerský', icon:'📋', href:'/trainer' });
  else if (me.is_assistant) roles.push({ key:'assistant', label:'Asistent', icon:'🤝', href:'/trainer' });
  const showSwitch = roles.length > 1;

  const navHtml = items.map(it=>{
    const href = it.key==='prof' ? ('/u/'+myId) : it.href;
    const isActive = it.key===active;
    return `<a href="${href}" class="${isActive?'fa-dock-active':''}" title="${it.label}" aria-label="${it.label}">
      ${svg(it.icon)}<span class="fa-dock-lbl">${it.label}</span></a>`;
  }).join('');
  const switchHtml = showSwitch ? `<button class="fa-dock-item" id="fa-switch" title="Prepnúť dashboard" aria-label="Prepnúť">${svg('swap')}<span class="fa-dock-lbl-s">Prepnúť</span></button>` : '';
  dock.innerHTML = navHtml + switchHtml;
  document.body.appendChild(dock);
  document.body.classList.add('fa-has-dock');

  if (showSwitch){
    const menu = document.createElement('div'); menu.id='fa-role-menu';
    menu.innerHTML = `<div class="rm-hd">Prepnúť dashboard</div>` + roles.map(r=>
      `<a href="${r.href}"><span class="rm-i">${r.icon}</span> ${r.label} dashboard</a>`).join('');
    document.body.appendChild(menu);
    const btn = document.getElementById('fa-switch');
    const place = ()=>{ const r=dock.getBoundingClientRect(); menu.style.bottom=(window.innerHeight-r.top+8)+'px'; };
    btn.addEventListener('click', e=>{ e.stopPropagation(); place(); menu.classList.toggle('on'); });
    document.addEventListener('click', e=>{ if(!menu.contains(e.target) && e.target!==btn) menu.classList.remove('on'); });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
else build();
})();
