# LEAD OS — jednotný zdieľaný systém starostlivosti o leady a klientky
*Scenár/špecifikácia (28.08.2026). Zadanie: Marek — „tréneri aj admini majú zdieľané informácie,
leady využité na 110 %, nikto nespamovaný, nikto nezabudnutý, dôležité oddelené s upozornením."*

## 0. Princípy (nemenné)

1. **Jedna pravda o človeku.** Každý ľudský kontakt (admin aj tréner) sa zapisuje do JEDNEJ
   vrstvy: `coach_contacts` (+ `users.last_contacted_at`). Každá poznámka do `lead_notes`.
   Žiadne paralelné súkromné evidencie.
2. **Semafor pred kontaktom.** Kto otvára kartu človeka, VŽDY vidí: kedy naposledy kontaktovaná,
   kým, s akým výsledkom, akú má poznámku, aké automatické maily dostala a KEDY PRÍDE ĎALŠÍ.
   Kontakt < 3 dni = systém človeka aktívne neponúka (coach filter aj neodkladné úlohy).
3. **Nikto nezabudnutý.** Lead s použiteľným kontaktom nesmie ostať bez dotyku > 21 dní bez
   plánu (follow-up/snooze/DNC). Watchdog to ráta a hlási.
4. **Dôležité oddelene + upozornenie.** HOT lead (čerstvá registrácia bez rezervácie, včerajší
   no-show, dopyt z webu) je vizuálne oddelený hore a systém naň pošle notifikáciu.
5. **DNC je svätý.** `do_not_contact` zastaví všetko (maily, SMS, zoznamy) — už platí, nemeniť.

## 1. Stav pred zásahom (zistené mapovaním 28.8.)

| Vrstva | Kde | Zdieľané? |
|---|---|---|
| Kontakty trénerov | `coach_contacts` | admin ich VIDÍ len pri leadoch (stĺpec + modal) |
| Poznámky trénerov | `lead_notes` | admin vidí len v maile-modáli; písať z UI nevie |
| Admin poznámka | `users.notes` | tréner ju NEVIDÍ (duplicitná vrstva) |
| Admin „kontaktovaná" | `users.last_contacted_at` | bez výsledku/poznámky, coach ju číta |
| Neodkladné úlohy | `computeUrgentTasks` (on-the-fly) | „Vybavené" NEzapíše kontakt → tréner osloví znova (spam!); 3-dňový skip len pri type `lapsed` |
| CRM úlohy / follow-upy | `crm_tasks` | zdieľané (coach zapisuje, admin sekcia zobrazuje) ✅ |
| Automatizácie | `email_queue`+`mail_log` | admin: plný obraz (`/leads/:id/emails`); tréner: len 15 odoslaných, NEVIDÍ čo príde |
| Detail klientky | `openClientDetail` modal | BEZ kontaktov, BEZ poznámok; zo zoznamu Klienti nedostupný |

## 2. Cieľový stav — čo sa dopĺňa

### 2.1 Zdieľaný zápis kontaktu (admin → jednotná vrstva)
- `POST /api/admin/leads/:id/contact` `{outcome, note, followup_date?}` → `coach_contacts`
  (`trainer_name: "<meno> (admin)"`, `by_role:'admin'`), `lead_notes` (ak note),
  `users.last_contacted_at`, voliteľný `crm_tasks` follow-up. Funguje pre leady AJ klientky.
- Admin UI: tlačidlo **📞 Kontakt** v tabuľke Leadov, v detaile klientky a v Neodkladných
  úlohách („✓ Vybavené + kontaktovaná" = dismiss + zápis kontaktu jedným klikom).
- Admin poznámka pri leadoch sa píše do `lead_notes` (zdieľaná); `users.notes` ostáva len
  na čítanie ako „stará poznámka", kým sa neprepíše.

### 2.2 Semafor + anti-spam
- `computeUrgentTasks`: KAŽDÝ typ úlohy sa skipne, ak existuje ľudský kontakt < 3 dni
  (lapsed ostáva 30 dní). Úloha nesie `last_contact` info — admin vidí, že už niekto volal.
- Coach smartLeads už filtruje 3 dni cez `coach_contacts` → po zjednotení zápisov sa admin
  kontakt počíta automaticky. Tým je spam-guard obojsmerný.

### 2.3 Jedna karta človeka (Starostlivosť)
- `/api/admin/crm/client/:id` navyše vracia: `contacts` (posledných 30 z coach_contacts),
  `notes` (lead_notes), `care` `{last_contact, next_mail {sequence, subject, scheduled_for},
  active_sequences, claimed_by}`.
- `openClientDetail`: nový tab **Starostlivosť** (história kontaktov+poznámok, zápis kontaktu
  a poznámky) + riadok „🤖 ďalší automatický mail: …" v hlavičke.
- Zoznam Klienti: nové tlačidlo 🗂 otvára tento modal (klik na meno ostáva → /u/:id).
- Tréner (`/api/coach/lead/:id`): navyše `next_mail` + `active_sequences` → v detaile leadu
  riadok „🤖 Automatika: winback · ďalší mail 30. 8." — tréner vie, že appka pracuje, a nevolá
  deň po automatickom maili naslepo.

### 2.4 HOT leady — oddelené + upozornenie
- Definícia (fáza 1): registrácia < 48 h bez rezervácie a bez kontaktu · včerajší no-show
  bez kontaktu · dopyt školy (school_lead) — už notifikuje, nemeniť.
- Coach `/today`: hot leady (score ≥ 80) sa renderujú v oddelenom bloku „🔥 Dnes dôležité"
  s červeným okrajom, zvyšok pod tým.
- Denný job 8:15 (guard `hot_leads_<dátum>`): spočíta hot leady dňa → in-app notifikácia
  VŠETKÝM trénerom aj adminom: „🔥 3 horúce leady čakajú — otvor Môj deň."
  (Appka nemá web-push; in-app zvonček + badge je existujúci kanál.)

### 2.5 Watchdog — nikto nezabudnutý
- Pojem „zabudnutý": použiteľný kontakt, nie DNC/not_interested, bez ľudského kontaktu > 21 dní,
  bez otvoreného follow-upu (crm_tasks), bez snooze, bez claimu.
- `/api/admin/leads` stats: `forgotten_count`; UI stats karta „🕸 Zabudnuté > 21 d".
- Pondelok ráno (guard `lead_watchdog_<týždeň>`): notifikácia adminom s počtom + 5 menami.
  (SmartLeads ich medzitým aj tak ponúka trénerom cez winback skóre — watchdog je poistka viditeľnosti.)

## 3. Čo sa NEROBÍ (a prečo)
- Nezlučujem číselníky `lead_status` × `outcome` — mapovanie `OUTCOME_TO_LEAD_STATUS` existuje
  a funguje; násilné zjednotenie by rozbilo históriu.
- Nezlučujem 3 task systémy do jedného — Neodkladné (počítané), CRM úlohy (ručné) a coach denné
  úlohy majú rôzne životné cykly; zjednocuje sa DÁTOVÁ vrstva pod nimi (kontakty/poznámky).
- Web-push sa nepridáva (nie je infra) — upozornenia = in-app notifikácie.

## 4. Meranie úspechu
- % leadov s použiteľným kontaktom, ktoré majú kontakt < 21 dní (cieľ > 90 %).
- Počet duplicitných kontaktov < 3 dni od dvoch rôznych ľudí (cieľ ~ 0) — vidno v coach_contacts.
- forgotten_count trend ↓.
- Konverzia hot leadov (kontakt < 24 h od registrácie → booking %) — už merateľné cez funnel.

## 5. Changelog implementácie
- v1 (28.08.2026): všetko z bodu 2, QA qa/lead-os.test.js.
