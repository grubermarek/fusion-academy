/**
 * Fusion Academy – Marketing attribution + ad pixels
 * Include with: <script src="/fa-track.js"></script>
 * Captures first-touch UTM/fbclid/gclid, loads Meta Pixel + Google tag
 * (IDs come from /api/config → META_PIXEL_ID / GOOGLE_ADS_ID env vars).
 */
(function(){
'use strict';
if(window.faTrack) return; // already loaded

function captureAttribution(){
  try {
    const p = new URLSearchParams(location.search);
    const keys = ['utm_source','utm_medium','utm_campaign','fbclid','gclid'];
    const stored = JSON.parse(localStorage.getItem('fa_attr')||'{}');
    const hasSignal = keys.some(k=>p.get(k));
    if(!stored.captured_at && hasSignal){
      const attr = {captured_at:new Date().toISOString(), landing:location.pathname+location.search, referrer:document.referrer||''};
      keys.forEach(k=>{ if(p.get(k)) attr[k]=p.get(k); });
      localStorage.setItem('fa_attr', JSON.stringify(attr));
    } else if(!stored.captured_at && document.referrer && !document.referrer.includes(location.hostname)){
      localStorage.setItem('fa_attr', JSON.stringify({captured_at:new Date().toISOString(), landing:location.pathname, referrer:document.referrer}));
    }
  } catch(e){}
}

// Per-page-load event id — rovnaké ide do atribúcie (server CAPI) aj do Pixelu (eventID) → Meta dedup
window.faEventId = function(){
  if(!window.__faEid){
    try { window.__faEid = [...crypto.getRandomValues(new Uint8Array(8))].map(b=>b.toString(16).padStart(2,'0')).join(''); }
    catch(e){ window.__faEid = 'e'+Math.random().toString(36).slice(2,14); }
  }
  return window.__faEid;
};

window.faGetAttribution = function(){
  try {
    const a = JSON.parse(localStorage.getItem('fa_attr')||'{}');
    const fbp = (document.cookie.match(/_fbp=([^;]+)/)||[])[1];
    if(fbp) a.fbp = fbp;
    a.event_id = window.faEventId();
    return a;
  } catch(e){ return {event_id:window.faEventId()}; }
};

async function loadPixels(){
  try {
    const cfg = await (await fetch('/api/config')).json();
    if(cfg.meta_pixel_id && !window.fbq){
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', cfg.meta_pixel_id);
      window.fbq('track', 'PageView');
    }
    if(cfg.google_ads_id && !window.gtag){
      const s=document.createElement('script'); s.async=true; s.src='https://www.googletagmanager.com/gtag/js?id='+cfg.google_ads_id;
      document.head.appendChild(s);
      window.dataLayer=window.dataLayer||[];
      window.gtag=function(){dataLayer.push(arguments);};
      window.gtag('js', new Date());
      window.gtag('config', cfg.google_ads_id);
    }
  } catch(e){}
}

window.faTrack = function(event, data={}){
  try {
    // eventID: explicitný (napr. 'pur_'+session_id) alebo pre CompleteRegistration page-load id (dedup s CAPI)
    const eid = data.eventID || (event==='CompleteRegistration' ? window.faEventId() : null);
    if(window.fbq) window.fbq('track', event, data.value?{value:data.value,currency:'EUR'}:{}, eid?{eventID:eid}:undefined);
    if(window.gtag){
      const map={CompleteRegistration:'sign_up', Purchase:'purchase', Lead:'generate_lead'};
      window.gtag('event', map[event]||event, data.value?{value:data.value,currency:'EUR'}:{});
      if(event==='CompleteRegistration'){
        window.gtag('event','conversion',{send_to:'AW-18386367227/LGSOCIrm2OAcEPvlpr9E',value:1.0,currency:'EUR'});
      }
    }
  } catch(e){}
};

captureAttribution();
loadPixels();
})();
