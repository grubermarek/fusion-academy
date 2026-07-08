/**
 * Fusion Academy – Shared Navigation Bar
 * Include with: <script src="/nav-bar.js"></script>
 * Auto-injects a sticky topbar + animated full-screen menu overlay.
 */
(function(){
'use strict';

/* ─── CSS ─────────────────────────────────────────────────── */
const css = `
#fa-nav-bar{
  position:fixed;top:0;left:0;right:0;height:56px;z-index:500;
  background:rgba(10,9,8,.9);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
  border-bottom:1px solid rgba(201,162,76,.2);
  display:flex;align-items:center;justify-content:space-between;
  padding:0 16px;gap:12px;
  font-family:'Manrope',system-ui,sans-serif;
}
#fa-nav-bar * { box-sizing:border-box; }

.fa-nb-logo{
  display:flex;align-items:center;gap:10px;text-decoration:none;
  color:#EAE3D5;font-weight:700;font-size:.78rem;letter-spacing:.2em;text-transform:uppercase;
  flex-shrink:0;
}
.fa-nb-logo svg{flex-shrink:0}
.fa-nb-center{
  display:flex;align-items:center;gap:4px;flex:1;justify-content:center;
  overflow:hidden;
}
.fa-nb-link{
  color:rgba(255,255,255,.55);text-decoration:none;font-size:.78rem;
  padding:5px 10px;border-radius:20px;transition:all .18s;white-space:nowrap;
  border:1px solid transparent;
}
.fa-nb-link:hover{color:#C9A24C;border-color:rgba(201,162,76,.3)}
.fa-nb-link.fa-nb-active{color:#C9A24C;border-color:rgba(201,162,76,.35);background:rgba(201,162,76,.1)}
@media(max-width:600px){.fa-nb-center{display:none}}

.fa-nb-right{display:flex;align-items:center;gap:8px;flex-shrink:0}
.fa-nb-auth{
  background:rgba(201,162,76,.12);border:1px solid rgba(201,162,76,.3);
  color:#C9A24C;padding:5px 13px;border-radius:20px;font-size:.78rem;
  font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap;
  transition:all .2s;font-family:inherit;
}
.fa-nb-auth:hover{background:rgba(201,162,76,.22)}
.fa-nb-menu{
  background:none;border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.7);
  width:36px;height:36px;border-radius:10px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  transition:all .2s;flex-shrink:0;font-size:1.1rem;
}
.fa-nb-menu:hover{border-color:rgba(201,162,76,.5);color:#C9A24C}
.fa-nb-menu.open{border-color:#C9A24C;color:#C9A24C;background:rgba(201,162,76,.1)}

/* ── Menu overlay (compact) ── */
#fa-menu-overlay{
  position:fixed;inset:0;z-index:600;
  background:rgba(10,10,10,.94);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  opacity:0;pointer-events:none;
  transition:opacity .22s ease;
  font-family:'Segoe UI',system-ui,sans-serif;
  padding:20px;
}
#fa-menu-overlay.fa-open{opacity:1;pointer-events:all}
#fa-menu-overlay *{box-sizing:border-box}

.fa-mo-close{
  position:absolute;top:14px;right:14px;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
  color:rgba(255,255,255,.65);width:36px;height:36px;border-radius:50%;
  cursor:pointer;display:flex;align-items:center;justify-content:center;
  font-size:1rem;transition:all .2s;
}
.fa-mo-close:hover{background:rgba(244,67,54,.15);border-color:rgba(244,67,54,.35);color:#ef9a9a;transform:rotate(90deg)}

.fa-mo-user{
  display:flex;align-items:center;gap:10px;
  margin-bottom:24px;padding:8px 16px 8px 8px;
  background:rgba(201,162,76,.07);border:1px solid rgba(201,162,76,.18);
  border-radius:30px;
  animation:faMoItemIn .3s ease both;
}
.fa-mo-avatar{
  width:32px;height:32px;border-radius:50%;
  background:linear-gradient(135deg,#C9A24C,#8a6020);
  display:flex;align-items:center;justify-content:center;
  font-size:.78rem;font-weight:700;color:#111;font-family:monospace;flex-shrink:0;
}
.fa-mo-user-name{font-size:.82rem;font-weight:600;color:#e8e8e8}
.fa-mo-login-hint{font-size:.82rem;color:#aaa;padding:0 6px}
.fa-mo-login-hint a{color:#C9A24C;text-decoration:none;font-weight:600}

.fa-mo-grid{
  display:grid;
  grid-template-columns:repeat(5,minmax(0,1fr));
  gap:8px;
  width:100%;max-width:600px;
}
@media(max-width:600px){.fa-mo-grid{grid-template-columns:repeat(3,1fr);gap:10px;max-width:340px}}
@media(max-width:360px){.fa-mo-grid{grid-template-columns:repeat(2,1fr)}}

.fa-mo-tile{
  border-radius:14px;padding:14px 8px;text-decoration:none;color:#e8e8e8;
  border:1px solid rgba(255,255,255,.07);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  position:relative;overflow:hidden;text-align:center;
  background:rgba(255,255,255,.03);
  transition:all .2s ease;
  opacity:0;aspect-ratio:1;
  animation:faMoItemIn .32s ease both;
}
.fa-mo-tile:hover{
  transform:translateY(-2px) scale(1.03);
  border-color:var(--fa-tc);
  background:rgba(var(--fa-tc-rgb),.1);
  box-shadow:0 6px 20px rgba(var(--fa-tc-rgb),.18);
}
.fa-mo-tile.fa-active-tile{
  border-color:var(--fa-tc);
  background:rgba(var(--fa-tc-rgb),.12);
  box-shadow:inset 0 0 0 1px rgba(var(--fa-tc-rgb),.3);
}
.fa-mo-tile-icon{font-size:1.7rem;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))}
.fa-mo-tile-name{font-size:.74rem;font-weight:700;line-height:1.1;letter-spacing:.01em}

.fa-mo-hint{
  margin-top:18px;font-size:.7rem;color:#555;
  letter-spacing:.04em;animation:faMoItemIn .3s ease both;animation-delay:.5s;
}

@keyframes faMoItemIn{
  from{opacity:0;transform:translateY(14px) scale(.96)}
  to{opacity:1;transform:translateY(0) scale(1)}
}
`;

/* ─── Nav items ────────────────────────────────────────────── */
const NAV_ITEMS = [
  {
    id:'schedule', label:'Rozvrh', href:'/schedule',
    icon:'📅', desc:'Hodiny, termíny, rezervácie',
    color:'#2196f3', rgb:'33,150,243',
    paths:['/schedule','/online']
  },
  {
    id:'pricing', label:'Členstvo', href:'/pricing',
    icon:'🏅', desc:'Bronze, Silver, Gold plány',
    color:'#C9A24C', rgb:'201,162,76',
    paths:['/pricing']
  },
  {
    id:'profile', label:'Profil', href:'/client-dashboard',
    icon:'👤', desc:'Rezervácie, vernosť, odmeny',
    color:'#9c27b0', rgb:'156,39,176',
    paths:['/client-dashboard','/dashboard']
  },
  {
    id:'shop', label:'Obchod', href:'/shop',
    icon:'🛍️', desc:'Herbalife, merch, výživa',
    color:'#4caf50', rgb:'76,175,80',
    paths:['/shop']
  },
  {
    id:'community', label:'Komunita', href:'/community',
    icon:'👥', desc:'Výzvy, sieťovanie',
    color:'#ff5722', rgb:'255,87,34',
    paths:['/community']
  }
];

/* ─── Helpers ──────────────────────────────────────────────── */
function currentPath(){ return window.location.pathname.replace(/\/$/, '') || '/'; }
function isActive(item){
  const p = currentPath();
  return item.paths.some(ip => p === ip || p.startsWith(ip + '/'));
}

/* ─── Build DOM ────────────────────────────────────────────── */
function injectStyles(){
  const el = document.createElement('style');
  el.id = 'fa-nav-styles';
  el.textContent = css;
  document.head.appendChild(el);
}

function buildNavBar(){
  const nav = document.createElement('div');
  nav.id = 'fa-nav-bar';

  // Logo
  nav.innerHTML = `
    <a class="fa-nb-logo" href="/">
      <svg width="26" height="26" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#111"/><text x="32" y="44" text-anchor="middle" font-family="serif" font-size="30" font-weight="700" fill="#C9A24C">FA</text></svg>
      Fusion Academy
    </a>
    <div class="fa-nb-center" id="fa-nb-links">
      ${NAV_ITEMS.map(item=>`
        <a class="fa-nb-link${isActive(item)?' fa-nb-active':''}" href="${item.href}">${item.label}</a>
      `).join('')}
    </div>
    <div class="fa-nb-right">
      <a class="fa-nb-auth" id="fa-nb-auth-btn" href="/client-dashboard" style="display:none">…</a>
      <button class="fa-nb-menu" id="fa-nb-menu-btn" title="Menu" aria-label="Menu">
        <svg width="18" height="14" viewBox="0 0 18 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="0" y1="1" x2="18" y2="1"/><line x1="0" y1="7" x2="18" y2="7"/><line x1="0" y1="13" x2="18" y2="13"/>
        </svg>
      </button>
    </div>
  `;

  // Put at very top of body
  document.body.insertBefore(nav, document.body.firstChild);
  return nav;
}

function buildOverlay(){
  const ov = document.createElement('div');
  ov.id = 'fa-menu-overlay';
  ov.setAttribute('aria-hidden','true');

  ov.innerHTML = `
    <button class="fa-mo-close" id="fa-mo-close-btn" aria-label="Zatvoriť">✕</button>

    <div class="fa-mo-user" id="fa-mo-user-block">
      <div class="fa-mo-avatar" id="fa-mo-avatar">?</div>
      <div id="fa-mo-user-info">
        <div class="fa-mo-login-hint"><a href="/client-dashboard">Prihlásiť sa →</a></div>
      </div>
    </div>

    <div class="fa-mo-grid" id="fa-mo-grid">
      ${NAV_ITEMS.map((item, i) => `
        <a class="fa-mo-tile${isActive(item)?' fa-active-tile':''}"
           href="${item.href}"
           style="--fa-tc:${item.color};--fa-tc-rgb:${item.rgb};animation-delay:${0.06 + i * 0.05}s">
          <div class="fa-mo-tile-icon">${item.icon}</div>
          <div class="fa-mo-tile-name">${item.label}</div>
        </a>
      `).join('')}
    </div>

    <div class="fa-mo-hint">ESC pre zatvorenie</div>
  `;

  document.body.appendChild(ov);
  return ov;
}

/* ─── Auth check ───────────────────────────────────────────── */
async function loadAuthState(){
  try {
    const r = await fetch('/api/me', { credentials:'include' });
    const me = await r.json();

    const authBtn = document.getElementById('fa-nb-auth-btn');
    const moAvatar = document.getElementById('fa-mo-avatar');
    const moUserInfo = document.getElementById('fa-mo-user-info');

    if(me && me.id){
      const name = me.name || me.email || 'Profil';
      const initials = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);

      // Topbar auth button
      if(authBtn){
        authBtn.style.display = '';
        authBtn.textContent = initials + ' ' + name.split(' ')[0];
        authBtn.href = '/client-dashboard';
      }

      // Overlay user block
      if(moAvatar) moAvatar.textContent = initials;
      if(moUserInfo){
        moUserInfo.innerHTML = `<div class="fa-mo-user-name">Ahoj, ${escH(name.split(' ')[0])} 👋</div>`;
      }
    } else {
      if(authBtn){
        authBtn.style.display = '';
        authBtn.textContent = 'Prihlásiť sa';
        authBtn.href = '/';
        authBtn.style.cssText += 'color:rgba(255,255,255,.65);border-color:rgba(255,255,255,.2)';
      }
    }
  } catch(e){}
}

function escH(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ─── Open / Close ─────────────────────────────────────────── */
let _menuOpen = false;

function openMenu(){
  _menuOpen = true;
  const ov = document.getElementById('fa-menu-overlay');
  const btn = document.getElementById('fa-nb-menu-btn');
  if(ov){ ov.classList.add('fa-open'); ov.setAttribute('aria-hidden','false'); }
  if(btn) btn.classList.add('open');
  document.body.style.overflow = 'hidden';
  // Re-trigger tile animations
  if(ov){
    ov.querySelectorAll('.fa-mo-tile').forEach((t,i)=>{
      t.style.animation='none';
      void t.offsetHeight;
      t.style.animation=`faMoItemIn .35s ease both`;
      t.style.animationDelay = (0.08 + i * 0.07)+'s';
    });
  }
}

function closeMenu(){
  _menuOpen = false;
  const ov = document.getElementById('fa-menu-overlay');
  const btn = document.getElementById('fa-nb-menu-btn');
  if(ov){ ov.classList.remove('fa-open'); ov.setAttribute('aria-hidden','true'); }
  if(btn) btn.classList.remove('open');
  document.body.style.overflow = '';
}

function toggleMenu(){ _menuOpen ? closeMenu() : openMenu(); }

/* ─── Ensure body has top padding ─────────────────────────── */
function addBodyPadding(){
  const style = window.getComputedStyle(document.body);
  const current = parseInt(style.paddingTop)||0;
  // Only add if the page doesn't already have enough room
  if(current < 56){
    document.body.style.paddingTop = Math.max(current, 56) + 'px';
  }
}

/* ─── Wire up events ───────────────────────────────────────── */
function wireEvents(){
  document.getElementById('fa-nb-menu-btn').addEventListener('click', e => { e.stopPropagation(); toggleMenu(); });
  document.getElementById('fa-mo-close-btn').addEventListener('click', closeMenu);

  // Clicking outside tile area in overlay closes it
  document.getElementById('fa-menu-overlay').addEventListener('click', e => {
    if(e.target.id === 'fa-menu-overlay') closeMenu();
  });

  // Esc key
  document.addEventListener('keydown', e => { if(e.key==='Escape' && _menuOpen) closeMenu(); });

  // Tile navigation closes menu before navigating (already navigates via href, but close state)
  document.querySelectorAll('.fa-mo-tile').forEach(t => {
    t.addEventListener('click', () => { setTimeout(closeMenu, 80); });
  });
}

/* ─── Marketing tracking (attribution + pixels) ────────────── */
function loadTracking(){
  if(!window.faTrack){
    const s=document.createElement('script'); s.src='/fa-track.js'; document.head.appendChild(s);
  }
}

/* ─── Init ─────────────────────────────────────────────────── */
function init(){
  loadTracking();
  injectStyles();
  const overlayOnly = document.body.getAttribute('data-fa-nav') === 'overlay-only';
  if(!overlayOnly){
    buildNavBar();
    addBodyPadding();
  }
  buildOverlay();
  wireEvents();
  loadAuthState();

  // Expose global toggle so other navbars can open the menu
  window.faNavOpen  = openMenu;
  window.faNavClose = closeMenu;
  window.faNavToggle = toggleMenu;
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
