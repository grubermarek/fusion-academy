/* Fusion Academy – lightweight i18n engine
   Usage:
     <script src="/i18n.js"></script>
     - Static text:  <span data-i18n="profile.back"></span>
     - Placeholder:  <textarea data-i18n-ph="profile.cmt_ph"></textarea>
     - In JS:        FA_T('profile.back')  or  FA_T('profile.badges',{n:3})
   Language priority: logged-in profile.lang → localStorage 'fa_lang' → browser → 'sk'
*/
(function(){
  const LANGS = [
    { code:'sk', flag:'🇸🇰', label:'Slovenčina' },
    { code:'cs', flag:'🇨🇿', label:'Čeština' },
    { code:'en', flag:'🇬🇧', label:'English' },
    { code:'uk', flag:'🇺🇦', label:'Українська' },
    { code:'hu', flag:'🇭🇺', label:'Magyar' },
    { code:'de', flag:'🇩🇪', label:'Deutsch' },
  ];

  const DICT = {
    sk:{
      'lang.name':'Jazyk',
      'profile.back':'Späť do komunity',
      'profile.loading':'Načítavam profil…',
      'profile.load_fail':'Profil sa nepodarilo načítať.',
      'profile.friends_remove':'Priatelia · odobrať',
      'profile.friend_sent':'Žiadosť odoslaná · zrušiť',
      'profile.friend_accept':'Prijať žiadosť',
      'profile.friend_add':'Pridať do priateľov',
      'profile.badges_of':'{n}/{m} odznakov',
      'profile.member_since':'{who} od {date}',
      'profile.member_f':'Členkou','profile.member_m':'Členom',
      'profile.membtag_f':'členka','profile.membtag_m':'člen',
      'profile.bg_hint':'🎨 Odomkni {tier} pozadie pri {need} odznakoch (máš {have})',
      'profile.anon':'🔒 Tento člen má profil nastavený ako anonymný.',
      'profile.stat_visits':'Návštev','profile.stat_struct':'V štruktúre','profile.stat_months':'Mesiacov',
      'profile.msg':'Napísať správu',
      'profile.earned_title':'🏆 Získané odznaky ({n})',
      'profile.no_badges':'Zatiaľ žiadne — poď na hodinu! 💃',
      'profile.to_unlock':'🔒 Ešte odomknúť',
      'profile.comments_title':'💬 Odkazy na profile',
      'profile.cmt_ph_self':'Napíš niečo na svoj profil…','profile.cmt_ph':'Zanechaj milý odkaz…',
      'profile.cmt_add':'Pridať',
      'profile.cmt_loading':'Načítavam odkazy…',
      'profile.cmt_none':'Zatiaľ žiadne odkazy. Buď prvá! 💛',
      'profile.cmt_fail':'Odkazy sa nepodarilo načítať.',
      'profile.cmt_del_q':'Zmazať tento odkaz?',
      'profile.likes':'{n} lajkov',
      'profile.nick_edit':'Zmeniť prezývku','profile.nick_add':'Pridať prezývku',
      'profile.nick_prompt':'Tvoja prezývka (zobrazí sa pod menom aj v komunitnom chate, max 30 znakov):',
      'profile.gender_f':'♀ Žena','profile.gender_m':'♂ Muž',
      'profile.membercard':'{tier} {word}',
      'settings.title':'⚙️ Nastavenia profilu','settings.nickname':'Prezývka','settings.gender':'Pohlavie',
      'settings.nick_ph':'Napr. ZumbaKráľovná','settings.save':'Uložiť','settings.saved':'Uložené ✓',
      'bg.bronze':'Bronzové','bg.silver':'Strieborné','bg.gold':'Zlaté','bg.legend':'Legendárne',
    },
    cs:{
      'lang.name':'Jazyk',
      'profile.back':'Zpět do komunity',
      'profile.loading':'Načítám profil…',
      'profile.load_fail':'Profil se nepodařilo načíst.',
      'profile.friends_remove':'Přátelé · odebrat',
      'profile.friend_sent':'Žádost odeslána · zrušit',
      'profile.friend_accept':'Přijmout žádost',
      'profile.friend_add':'Přidat mezi přátele',
      'profile.badges_of':'{n}/{m} odznaků',
      'profile.member_since':'{who} od {date}',
      'profile.member_f':'Členkou','profile.member_m':'Členem',
      'profile.membtag_f':'členka','profile.membtag_m':'člen',
      'profile.bg_hint':'🎨 Odemkni {tier} pozadí při {need} odznacích (máš {have})',
      'profile.anon':'🔒 Tento člen má profil nastavený jako anonymní.',
      'profile.stat_visits':'Návštěv','profile.stat_struct':'Ve struktuře','profile.stat_months':'Měsíců',
      'profile.msg':'Napsat zprávu',
      'profile.earned_title':'🏆 Získané odznaky ({n})',
      'profile.no_badges':'Zatím žádné — přijď na hodinu! 💃',
      'profile.to_unlock':'🔒 Ještě odemknout',
      'profile.comments_title':'💬 Vzkazy na profilu',
      'profile.cmt_ph_self':'Napiš něco na svůj profil…','profile.cmt_ph':'Zanech milý vzkaz…',
      'profile.cmt_add':'Přidat',
      'profile.cmt_loading':'Načítám vzkazy…',
      'profile.cmt_none':'Zatím žádné vzkazy. Buď první! 💛',
      'profile.cmt_fail':'Vzkazy se nepodařilo načíst.',
      'profile.cmt_del_q':'Smazat tento vzkaz?',
      'profile.likes':'{n} lajků',
      'profile.nick_edit':'Změnit přezdívku','profile.nick_add':'Přidat přezdívku',
      'profile.nick_prompt':'Tvoje přezdívka (zobrazí se pod jménem i v komunitním chatu, max 30 znaků):',
      'profile.gender_f':'♀ Žena','profile.gender_m':'♂ Muž',
      'profile.membercard':'{tier} {word}',
      'settings.title':'⚙️ Nastavení profilu','settings.nickname':'Přezdívka','settings.gender':'Pohlaví',
      'settings.nick_ph':'Např. ZumbaKrálovna','settings.save':'Uložit','settings.saved':'Uloženo ✓',
      'bg.bronze':'Bronzové','bg.silver':'Stříbrné','bg.gold':'Zlaté','bg.legend':'Legendární',
    },
    en:{
      'lang.name':'Language',
      'profile.back':'Back to community',
      'profile.loading':'Loading profile…',
      'profile.load_fail':'Failed to load profile.',
      'profile.friends_remove':'Friends · remove',
      'profile.friend_sent':'Request sent · cancel',
      'profile.friend_accept':'Accept request',
      'profile.friend_add':'Add friend',
      'profile.badges_of':'{n}/{m} badges',
      'profile.member_since':'{who} since {date}',
      'profile.member_f':'Member','profile.member_m':'Member',
      'profile.membtag_f':'member','profile.membtag_m':'member',
      'profile.bg_hint':'🎨 Unlock the {tier} background at {need} badges (you have {have})',
      'profile.anon':'🔒 This member has set their profile to anonymous.',
      'profile.stat_visits':'Visits','profile.stat_struct':'In network','profile.stat_months':'Months',
      'profile.msg':'Send a message',
      'profile.earned_title':'🏆 Earned badges ({n})',
      'profile.no_badges':'None yet — come to a class! 💃',
      'profile.to_unlock':'🔒 Still to unlock',
      'profile.comments_title':'💬 Profile messages',
      'profile.cmt_ph_self':'Write something on your profile…','profile.cmt_ph':'Leave a kind note…',
      'profile.cmt_add':'Post',
      'profile.cmt_loading':'Loading messages…',
      'profile.cmt_none':'No messages yet. Be the first! 💛',
      'profile.cmt_fail':'Failed to load messages.',
      'profile.cmt_del_q':'Delete this message?',
      'profile.likes':'{n} likes',
      'profile.nick_edit':'Change nickname','profile.nick_add':'Add nickname',
      'profile.nick_prompt':'Your nickname (shown under your name and in the community chat, max 30 chars):',
      'profile.gender_f':'♀ Female','profile.gender_m':'♂ Male',
      'profile.membercard':'{tier} {word}',
      'settings.title':'⚙️ Profile settings','settings.nickname':'Nickname','settings.gender':'Gender',
      'settings.nick_ph':'e.g. ZumbaQueen','settings.save':'Save','settings.saved':'Saved ✓',
      'bg.bronze':'Bronze','bg.silver':'Silver','bg.gold':'Gold','bg.legend':'Legendary',
    },
    uk:{
      'lang.name':'Мова',
      'profile.back':'Назад до спільноти',
      'profile.loading':'Завантаження профілю…',
      'profile.load_fail':'Не вдалося завантажити профіль.',
      'profile.friends_remove':'Друзі · видалити',
      'profile.friend_sent':'Запит надіслано · скасувати',
      'profile.friend_accept':'Прийняти запит',
      'profile.friend_add':'Додати в друзі',
      'profile.badges_of':'{n}/{m} відзнак',
      'profile.member_since':'{who} з {date}',
      'profile.member_f':'Учасниця','profile.member_m':'Учасник',
      'profile.membtag_f':'учасниця','profile.membtag_m':'учасник',
      'profile.bg_hint':'🎨 Відкрий {tier} фон при {need} відзнаках (маєш {have})',
      'profile.anon':'🔒 Цей учасник зробив профіль анонімним.',
      'profile.stat_visits':'Відвідувань','profile.stat_struct':'У структурі','profile.stat_months':'Місяців',
      'profile.msg':'Написати повідомлення',
      'profile.earned_title':'🏆 Отримані відзнаки ({n})',
      'profile.no_badges':'Поки немає — приходь на заняття! 💃',
      'profile.to_unlock':'🔒 Ще відкрити',
      'profile.comments_title':'💬 Повідомлення на профілі',
      'profile.cmt_ph_self':'Напиши щось на своєму профілі…','profile.cmt_ph':'Залиш приємне слово…',
      'profile.cmt_add':'Додати',
      'profile.cmt_loading':'Завантаження повідомлень…',
      'profile.cmt_none':'Поки немає повідомлень. Будь першою! 💛',
      'profile.cmt_fail':'Не вдалося завантажити повідомлення.',
      'profile.cmt_del_q':'Видалити це повідомлення?',
      'profile.likes':'{n} вподобань',
      'profile.nick_edit':'Змінити псевдонім','profile.nick_add':'Додати псевдонім',
      'profile.nick_prompt':'Твій псевдонім (показується під іменем і в чаті спільноти, макс. 30 символів):',
      'profile.gender_f':'♀ Жінка','profile.gender_m':'♂ Чоловік',
      'profile.membercard':'{tier} {word}',
      'settings.title':'⚙️ Налаштування профілю','settings.nickname':'Псевдонім','settings.gender':'Стать',
      'settings.nick_ph':'Напр. ЗумбаКоролева','settings.save':'Зберегти','settings.saved':'Збережено ✓',
      'bg.bronze':'Бронзовий','bg.silver':'Срібний','bg.gold':'Золотий','bg.legend':'Легендарний',
    },
    hu:{
      'lang.name':'Nyelv',
      'profile.back':'Vissza a közösséghez',
      'profile.loading':'Profil betöltése…',
      'profile.load_fail':'A profil betöltése sikertelen.',
      'profile.friends_remove':'Barátok · eltávolítás',
      'profile.friend_sent':'Kérés elküldve · visszavonás',
      'profile.friend_accept':'Kérés elfogadása',
      'profile.friend_add':'Barát hozzáadása',
      'profile.badges_of':'{n}/{m} jelvény',
      'profile.member_since':'{who} {date} óta',
      'profile.member_f':'Tag','profile.member_m':'Tag',
      'profile.membtag_f':'tag','profile.membtag_m':'tag',
      'profile.bg_hint':'🎨 Oldd fel a(z) {tier} hátteret {need} jelvénynél (most {have} van)',
      'profile.anon':'🔒 Ez a tag névtelenre állította a profilját.',
      'profile.stat_visits':'Látogatás','profile.stat_struct':'A hálózatban','profile.stat_months':'Hónap',
      'profile.msg':'Üzenet küldése',
      'profile.earned_title':'🏆 Megszerzett jelvények ({n})',
      'profile.no_badges':'Még egy sincs — gyere el egy órára! 💃',
      'profile.to_unlock':'🔒 Még feloldható',
      'profile.comments_title':'💬 Üzenetek a profilon',
      'profile.cmt_ph_self':'Írj valamit a profilodra…','profile.cmt_ph':'Hagyj egy kedves üzenetet…',
      'profile.cmt_add':'Küldés',
      'profile.cmt_loading':'Üzenetek betöltése…',
      'profile.cmt_none':'Még nincs üzenet. Legyél te az első! 💛',
      'profile.cmt_fail':'Az üzenetek betöltése sikertelen.',
      'profile.cmt_del_q':'Törlöd ezt az üzenetet?',
      'profile.likes':'{n} kedvelés',
      'profile.nick_edit':'Becenév módosítása','profile.nick_add':'Becenév hozzáadása',
      'profile.nick_prompt':'A beceneved (a neved alatt és a közösségi chatben jelenik meg, max. 30 karakter):',
      'profile.gender_f':'♀ Nő','profile.gender_m':'♂ Férfi',
      'profile.membercard':'{tier} {word}',
      'settings.title':'⚙️ Profilbeállítások','settings.nickname':'Becenév','settings.gender':'Nem',
      'settings.nick_ph':'Pl. ZumbaKirálynő','settings.save':'Mentés','settings.saved':'Mentve ✓',
      'bg.bronze':'Bronz','bg.silver':'Ezüst','bg.gold':'Arany','bg.legend':'Legendás',
    },
    de:{
      'lang.name':'Sprache',
      'profile.back':'Zurück zur Community',
      'profile.loading':'Profil wird geladen…',
      'profile.load_fail':'Profil konnte nicht geladen werden.',
      'profile.friends_remove':'Freunde · entfernen',
      'profile.friend_sent':'Anfrage gesendet · abbrechen',
      'profile.friend_accept':'Anfrage annehmen',
      'profile.friend_add':'Freund hinzufügen',
      'profile.badges_of':'{n}/{m} Abzeichen',
      'profile.member_since':'{who} seit {date}',
      'profile.member_f':'Mitglied','profile.member_m':'Mitglied',
      'profile.membtag_f':'Mitglied','profile.membtag_m':'Mitglied',
      'profile.bg_hint':'🎨 Schalte den {tier} Hintergrund bei {need} Abzeichen frei (du hast {have})',
      'profile.anon':'🔒 Dieses Mitglied hat sein Profil auf anonym gestellt.',
      'profile.stat_visits':'Besuche','profile.stat_struct':'Im Netzwerk','profile.stat_months':'Monate',
      'profile.msg':'Nachricht senden',
      'profile.earned_title':'🏆 Erhaltene Abzeichen ({n})',
      'profile.no_badges':'Noch keine — komm zu einem Kurs! 💃',
      'profile.to_unlock':'🔒 Noch freizuschalten',
      'profile.comments_title':'💬 Nachrichten am Profil',
      'profile.cmt_ph_self':'Schreib etwas auf dein Profil…','profile.cmt_ph':'Hinterlasse eine nette Nachricht…',
      'profile.cmt_add':'Senden',
      'profile.cmt_loading':'Nachrichten werden geladen…',
      'profile.cmt_none':'Noch keine Nachrichten. Sei die Erste! 💛',
      'profile.cmt_fail':'Nachrichten konnten nicht geladen werden.',
      'profile.cmt_del_q':'Diese Nachricht löschen?',
      'profile.likes':'{n} Likes',
      'profile.nick_edit':'Spitznamen ändern','profile.nick_add':'Spitznamen hinzufügen',
      'profile.nick_prompt':'Dein Spitzname (erscheint unter deinem Namen und im Community-Chat, max. 30 Zeichen):',
      'profile.gender_f':'♀ Frau','profile.gender_m':'♂ Mann',
      'profile.membercard':'{tier} {word}',
      'settings.title':'⚙️ Profileinstellungen','settings.nickname':'Spitzname','settings.gender':'Geschlecht',
      'settings.nick_ph':'z. B. ZumbaKönigin','settings.save':'Speichern','settings.saved':'Gespeichert ✓',
      'bg.bronze':'Bronze','bg.silver':'Silber','bg.gold':'Gold','bg.legend':'Legendär',
    },
  };

  let cur = 'sk';
  function detect(){
    const ls = localStorage.getItem('fa_lang');
    if(ls && DICT[ls]) return ls;
    const b = (navigator.language||'sk').slice(0,2).toLowerCase();
    return DICT[b] ? b : 'sk';
  }
  function t(key, vars){
    let s = (DICT[cur] && DICT[cur][key]) || (DICT.sk[key]) || key;
    if(vars) for(const k in vars) s = s.replace(new RegExp('\\{'+k+'\\}','g'), vars[k]);
    return s;
  }
  function apply(root){
    (root||document).querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent = t(el.getAttribute('data-i18n')); });
    (root||document).querySelectorAll('[data-i18n-ph]').forEach(el=>{ el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
  }
  async function setLang(code, opts){
    if(!DICT[code]) return;
    cur = code;
    localStorage.setItem('fa_lang', code);
    document.documentElement.setAttribute('lang', code);
    // persist to profile if logged in (best-effort)
    try { await fetch('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({lang:code})}); } catch(e){}
    if(opts && opts.reload) location.reload();
    else { apply(); document.dispatchEvent(new CustomEvent('fa-lang-changed',{detail:{lang:code}})); }
  }
  // Build a compact <select> switcher into a target element (by id or node)
  function mount(target){
    const host = typeof target==='string' ? document.getElementById(target) : target;
    if(!host) return;
    const sel = document.createElement('select');
    sel.className = 'fa-lang-select';
    sel.setAttribute('aria-label', t('lang.name'));
    LANGS.forEach(l=>{ const o=document.createElement('option'); o.value=l.code; o.textContent=l.flag+' '+l.label; if(l.code===cur) o.selected=true; sel.appendChild(o); });
    sel.addEventListener('change', ()=>setLang(sel.value,{reload:true}));
    host.appendChild(sel);
  }

  // init: prefer server-provided lang (window.FA_USER_LANG) else localStorage/browser
  cur = (window.FA_USER_LANG && DICT[window.FA_USER_LANG]) ? window.FA_USER_LANG : detect();
  document.documentElement.setAttribute('lang', cur);

  window.FA_I18N = { t, apply, setLang, mount, langs:LANGS, get lang(){return cur;} };
  window.FA_T = t;
  document.addEventListener('DOMContentLoaded', ()=>apply());
})();
