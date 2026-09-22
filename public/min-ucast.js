/* Minimálny počet prihlásených pri hodine — Brezno, Zvolen, Banská Bystrica (Marek 22. 9. 2026).
 * Server posiela pri hodine min_ucast {pocet, hodin, kde, predlzenie, prihlasenych}
 * (nastavenie je jedine v server.js → MIN_UCAST). Tu z toho vznikne riadok
 * „👥 Prihlásených 5 z 8 potrebných" s otáznikom, ktorý rozbalí vysvetlenie.
 *   FA_MIN.riadok(min_ucast)  → HTML riadku (prázdny reťazec, ak hodina minimum nemá)
 *   FA_MIN.info(min_ucast)    → HTML vysvetlenia (napr. do potvrdenia rezervácie)
 */
(function () {
  if (window.FA_MIN) return;
  var CSS = ''
    + '.fa-min{margin-top:10px;font-size:.8rem;line-height:1.4;text-align:left}'
    + '.fa-min-row{display:flex;align-items:center;gap:8px;width:100%;background:rgba(255,183,77,.10);border:1px solid rgba(255,183,77,.38);'
    + 'color:inherit;border-radius:12px;padding:8px 10px;font:inherit;cursor:pointer;text-align:left;-webkit-tap-highlight-color:transparent}'
    + '.fa-min-row.ok{background:rgba(74,222,128,.09);border-color:rgba(74,222,128,.35)}'
    + '.fa-min-row:focus-visible{outline:2px solid #ffb74d;outline-offset:2px}'
    + '.fa-min-txt{flex:1;min-width:0}'
    + '.fa-min-txt b{font-weight:800}'
    + '.fa-min-q{flex:none;width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;'
    + 'background:rgba(255,183,77,.22);color:#ffb74d;font-weight:900;font-size:.8rem}'
    + '.fa-min-row.ok .fa-min-q{background:rgba(74,222,128,.2);color:#4ade80}'
    + '.fa-min-row[aria-expanded="true"] .fa-min-q{background:#ffb74d;color:#1a1408}'
    + '.fa-min-info{margin-top:6px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px 12px;color:inherit}'
    + '.fa-min-info[hidden]{display:none}'
    + '.fa-min-info p{margin:0 0 6px}'
    + '.fa-min-info ul{margin:4px 0 0;padding-left:18px}'
    + '.fa-min-info li{margin:2px 0}';
  function styl() {
    if (document.getElementById('faMinCss')) return;
    var s = document.createElement('style'); s.id = 'faMinCss'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  function sklon(n, jeden, dva, pat) { return n === 1 ? jeden : (n >= 2 && n <= 4 ? dva : pat); }
  function platne(m) { return !!(m && m.pocet > 0); }

  function info(m) {
    if (!platne(m)) return '';
    var h = m.hodin || 3, d = m.predlzenie || 0;
    var body = [];
    body.push('vstup z permanentky alebo hodinu zdarma, ktorými si hodinu platila, ti vrátime');
    if (d > 0) body.push('členstvo ti predĺžime o ' + d + ' ' + sklon(d, 'deň', 'dni', 'dní'));
    body.push('dáme ti vedieť v appke aj e-mailom');
    return '<p><b>Hodina ' + m.kde + ' sa koná, keď je prihlásených aspoň ' + m.pocet + ' ľudí.</b></p>'
      + '<p>Rezervuj si miesto čím skôr, nečakaj na poslednú chvíľu a pozvi aj kamošku. '
      + 'Ak ' + h + ' ' + sklon(h, 'hodinu', 'hodiny', 'hodín') + ' pred začiatkom nebude prihlásených aspoň '
      + m.pocet + ', hodinu zrušíme.</p>'
      + '<p style="margin-bottom:0">Keď sa hodina zruší:</p><ul><li>' + body.join(',</li><li>') + '.</li></ul>';
  }

  function riadok(m) {
    if (!platne(m)) return '';
    styl();
    var n = m.prihlasenych, txt, ok = false;
    if (typeof n !== 'number') txt = '👥 Koná sa od <b>' + m.pocet + ' prihlásených</b>';
    else if (n >= m.pocet) { ok = true; txt = '✅ Prihlásených <b>' + n + '</b> · minimum ' + m.pocet + ' je splnené'; }
    else txt = '👥 Prihlásených <b>' + n + ' z ' + m.pocet + '</b> potrebných · chýba ' + (m.pocet - n);
    return '<div class="fa-min">'
      + '<button type="button" class="fa-min-row' + (ok ? ' ok' : '') + '" aria-expanded="false" '
      + 'onclick="FA_MIN.prepni(this,event)" title="Kedy sa hodina koná">'
      + '<span class="fa-min-txt">' + txt + '</span><span class="fa-min-q" aria-hidden="true">?</span></button>'
      + '<div class="fa-min-info" hidden>' + info(m) + '</div></div>';
  }

  function prepni(btn, ev) {
    if (ev) { ev.stopPropagation(); ev.preventDefault(); }
    var box = btn.closest('.fa-min'); if (!box) return;
    var inf = box.querySelector('.fa-min-info'); if (!inf) return;
    var otvor = inf.hidden;
    inf.hidden = !otvor;
    btn.setAttribute('aria-expanded', otvor ? 'true' : 'false');
  }

  window.FA_MIN = { riadok: riadok, info: info, prepni: prepni };
})();
