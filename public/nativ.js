/* ═══════════════════════════════════════════════════════════════════════════
   MOSTÍK MEDZI APPKOU A TELEFÓNOM (Capacitor)

   Appku v App Store nahrádzame našou (Marek 19. 10. 2026) — vnútri obalu beží
   tá istá stránka ako v prehliadači, len navyše vie veci, ktoré web nevie:
   natívne upozornenia, vibrovanie a zdieľanie. V bežnom prehliadači sa tento
   súbor nestane ničím — `window.Capacitor` tam neexistuje.

   Zapojenie: <script src="/nativ.js" defer></script>
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  const C = window.Capacitor;
  if(!C || !C.Plugins) return;                       // bežný prehliadač → koniec
  const P = C.Plugins;
  const verzia = '9.0.0';
  window.FA_NATIV = { jeApp:true, platforma: (C.getPlatform && C.getPlatform()) || 'ios' };
  document.documentElement.classList.add('fa-nativ');

  // ── Upozornenia na telefón ────────────────────────────────────────────────
  async function zapniPush(){
    try{
      if(!P.PushNotifications) return;
      // Povolenie pýtame až keď je klientka prihlásená — inak jej to vyskočí
      // hneď po inštalácii a väčšina dá „nepovoliť".
      const me = await fetch('/api/me',{credentials:'include'}).then(r=>r.ok?r.json():null).catch(()=>null);
      if(!me || !(me.id || me._id)) return;

      let stav = await P.PushNotifications.checkPermissions();
      if(stav.receive === 'prompt' || stav.receive === 'prompt-with-rationale')
        stav = await P.PushNotifications.requestPermissions();
      if(stav.receive !== 'granted') return;

      P.PushNotifications.addListener('registration', t => {
        fetch('/api/push/device',{ method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ token:t.value, platform:window.FA_NATIV.platforma, app_version:verzia }) }).catch(()=>{});
      });
      P.PushNotifications.addListener('registrationError', e => console.warn('push registrácia:', e));
      // Klik na upozornenie → otvor, čoho sa týka
      P.PushNotifications.addListener('pushNotificationActionPerformed', a => {
        const typ = (a && a.notification && a.notification.data && a.notification.data.typ) || '';
        const kam = { class_cancelled:'/schedule', booking:'/client-dashboard', membership:'/client-dashboard',
                      private_booking:'/client-dashboard', credit:'/obchod', trial:'/obchod' }[typ] || '/client-dashboard';
        location.href = kam;
      });
      await P.PushNotifications.register();
      // Po otvorení appky zhoď odznak s číslom
      try{ await P.PushNotifications.removeAllDeliveredNotifications(); }catch(e){}
    }catch(e){ console.warn('push:', e && e.message); }
  }

  // ── Vibrovanie pri potvrdení (rezervácia, platba) ─────────────────────────
  window.FA_NATIV.vibruj = async (typ='light') => {
    try{ if(P.Haptics) await P.Haptics.impact({ style: typ==='heavy' ? 'HEAVY' : typ==='medium' ? 'MEDIUM' : 'LIGHT' }); }catch(e){}
  };
  // ── Natívne zdieľanie (pozvi kamošku) ─────────────────────────────────────
  window.FA_NATIV.zdielaj = async (text, url) => {
    try{ if(P.Share){ await P.Share.share({ title:'Fusion Academy', text, url }); return true; } }catch(e){}
    return false;
  };

  // ── Vzhľad: stavový riadok a odznak ───────────────────────────────────────
  (async()=>{
    try{ if(P.StatusBar){ await P.StatusBar.setStyle({ style:'DARK' }); } }catch(e){}
    try{ if(P.SplashScreen) await P.SplashScreen.hide(); }catch(e){}
  })();

  // Appka sa vrátila do popredia → zhoď doručené upozornenia
  try{
    if(P.App) P.App.addListener('appStateChange', s => {
      if(s.isActive && P.PushNotifications) P.PushNotifications.removeAllDeliveredNotifications().catch(()=>{});
    });
  }catch(e){}

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', zapniPush);
  else zapniPush();
})();
