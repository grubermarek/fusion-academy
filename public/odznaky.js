/* Odznak členstva pri mene.
   Bronze/Silver/Gold majú vlastné obrázkové odznaky (Marek 1. 9.) — medaily
   🥇🥈🥉 sa mýlili s umiestnením v mesačnej súťaži, kde medaily tiež sú.
   Rolové odznaky personálu (majiteľ, tréner, asistent) ostávajú emoji.

   Používa sa všade, kde sa vypisuje meno s odznakom, nech to nemusí každá
   stránka riešiť po svojom: faOdznak(user.memberBadge) */
(function () {
  if (window.faOdznak) return;
  window.faOdznak = function (b, px) {
    if (!b) return '';
    const v = px || 18;
    const popis = String(b.label || '').replace(/"/g, '&quot;');
    if (b.icon) {
      return '<img class="fa-odznak" src="' + b.icon + '" alt="' + popis + '" title="' + popis + '"'
        + ' style="width:' + v + 'px;height:' + v + 'px;vertical-align:-.22em;display:inline-block">';
    }
    return b.emoji ? '<span title="' + popis + '">' + b.emoji + '</span>' : '';
  };
})();
