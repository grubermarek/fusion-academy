# Fusion Academy — Plán vývoja (pre AI agenta)

> Tento dokument je určený pre AI asistenta (aj menší model), ktorý má úlohy postupne
> implementovať. Pracuj VŽDY v poradí fáz. Po každej fáze: syntax check, lokálny test,
> commit + push (Railway sa deployne automaticky z GitHub main).

---

## 0. Kontext projektu — PREČÍTAJ PRED KAŽDOU PRÁCOU

- **Čo to je:** Webová appka tanečnej školy Fusion Academy (náhrada Glofox). Klienti si
  rezervujú hodiny, kupujú členstvá, admin riadi školu.
- **Stack:** Node.js + Express, NeDB (súborová DB), Socket.io, PayPal, vanilla JS frontend
  (žiadny framework), Bootstrap 5 + vlastný `fa-theme.css` (zlato-čierna téma, akcent `#C9A84C`).
- **Kód:** `server.js` (~3300 riadkov, všetko backend) + `public/*.html` (každá stránka má
  vlastný inline JS).
- **Deploy:** GitHub `grubermarek/fusion-academy` → Railway auto-deploy z `main`.
  Dáta na Railway Volume `/app/data` (env `DATA_DIR`).
- **Lokálny beh:** `node server.js` na porte 3000. Admin: `admin@fusionacademy.sk` / `admin123`.
- **Marketingová stránka beží na webe** (latindancefusion.art, Wix) — appka obsahuje LEN
  prevádzku školy. Marketingové stránky NEpridávaj do appky.

### Konvencie a známe pasce (DÔLEŽITÉ)

1. **NeDB queries** cez helper `q` v server.js: `q.find/one/insert/update/remove` (Promise).
2. **Auth middlewares:** `auth` (prihlásený), `adminAuth`, `trainerAuth`. API vracia JSON
   `{error:'...'}` pri chybe.
3. **Kolekcia `db.memberships` je znečistená** — obsahuje aj záznamy `_type:'body_analysis'`
   a `_type:'fit_premena'`. Pri práci s členstvami VŽDY filtruj `!m._type`.
4. **Frontend `api()` helpery** — každá stránka má vlastný. Niektoré serializujú body samé
   (client-dashboard, trainer, body-analysis, online, fit-premena, admin, dashboard),
   ak pridávaš nový, VŽDY `JSON.stringify(body)`.
5. **Service worker** `public/sw.js` — pri KAŽDEJ zmene JS/CSS/HTML zvýš verziu cache
   (`fa-v3` → `fa-v4` ...), inak klienti uvidia staré súbory.
6. **PayPal:** jednorazové platby cez `/api/paypal/create-order` + `capture-order`;
   subscriptions cez `/api/membership/subscribe` + `subscribe/activate` (parameter `plan_id`!).
7. **Emaily:** funkcia `sendMail(to,subject,html)` + šablóna `emailTemplate(...)`.
   Poradie providerov: Brevo API (`BREVO_API_KEY`) → Resend → SMTP. Railway blokuje SMTP porty!
8. **Denné automatizácie** vo funkcii `runDailyJobs()` (beží o 8:00) — nové automatizácie
   pridávaj tam, s deduplikáciou cez `db.notifications` (pozri existujúce vzory).
9. **Marketing tracking:** `public/fa-track.js` (atribúcia + pixely), server ukladá
   atribúciu pri registrácii, Meta CAPI cez `metaCapi()`/`trackPurchase()`.
10. **Storno policy:** `CANCEL_DEADLINE_HOURS` (default 3), no-show tracking v daily jobs.
11. **Commit správy:** anglicky, stručne, s pätičkou
    `Co-Authored-By: Claude <noreply@anthropic.com>`.
12. **Testovanie:** `node --check server.js` po každej zmene servera; potom spusti lokálne
    a otestuj endpointy fetch-om (prihlás sa ako admin). Testovacie dáta po sebe zmaž.

### Env premenné (Railway → Variables)

| Premenná | Stav | Účel |
|---|---|---|
| `DATA_DIR=/app/data` | ✅ nastavené | Railway Volume |
| `BREVO_API_KEY` | ⏳ čaká na užívateľa | emaily (HTTP API) |
| `META_PIXEL_ID`, `META_CAPI_TOKEN`, `GOOGLE_ADS_ID` | ⏳ čaká | reklamné pixely |
| `GOOGLE_REVIEW_URL` | ⏳ čaká | žiadosť o recenziu po 5. návšteve |
| `CANCEL_DEADLINE_HOURS` | voliteľné (default 3) | storno deadline |
| `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET` | ⏳ čaká | platby |

---

## FÁZA 1 — Rodinné účty (rodič + deti) ✅ HOTOVO (2026-07-07)

> Implementované: kolekcia detí v `db.users` (`parent_id`, `is_child`, unikátny
> `CHILD-` referral_code kvôli unique indexu). Endpointy `/api/family/children`
> (GET/POST/PUT/DELETE), booking + membership buy podporujú `for_child_id`,
> `/api/me/qr?child_id=`, `/api/my-bookings` vracia aj deti, QR check-in funguje
> (deti sa nájdu podľa mena). Deti vylúčené z komunity a marketing štatistík.
> Frontend: sekcia "Moja rodina" v client-dashboard (pridať/zmazať/QR/rezervovať),
> selektor "Pre koho" v schedule.html (`?child=<id>` predvýber). Overené naživo.
> POZN: milestones (Fáza 7.1) už existovali v kóde (`LOYALTY_MILESTONES`).

### PÔVODNÁ ŠPECIFIKÁCIA (referencia)
## FÁZA 1 (pôvodne) — Rodinné účty (rodič + deti)

**Prečo:** tanečná škola má detské kurzy; rodičia potrebujú spravovať deti pod jedným účtom.

### 1.1 Dátový model
- Do `db.users` pridaj koncept "child profilu": nová kolekcia NIE JE potrebná — dieťa je
  záznam v `db.users` s poľami `parent_id` (id rodiča), `is_child:true`, `birth_year`,
  BEZ emailu/hesla (email nastav `child-<id>@internal.local` kvôli unique indexu).
- Rodič = bežný user, deti sa naňho viažu cez `parent_id`.

### 1.2 Backend endpointy (všetky `auth`)
- `POST /api/family/children` — vytvor dieťa `{name, birth_year}` (max 6 detí).
- `GET /api/family/children` — zoznam mojich detí.
- `PUT /api/family/children/:id` — uprav meno/ročník (over `parent_id === session.uid`).
- `DELETE /api/family/children/:id` — zmaž (soft: `active:false`).
- **Rezervácie za dieťa:** `POST /api/bookings` prijme voliteľné `for_child_id`; over,
  že dieťa patrí rodičovi; booking dostane `user_id = child_id` a `booked_by = parent_id`.
  Free-class/membership gate vyhodnocuj podľa DIEŤAŤA.
- **Členstvo pre dieťa:** `POST /api/membership/buy` a subscribe prijmú `for_child_id`,
  membership sa aktivuje dieťaťu, platí rodič.
- `GET /api/my-bookings` vráti aj rezervácie detí (pridaj pole `child_name`).
- QR kód: `GET /api/me/qr` prijme `?child_id=` a vráti QR dieťaťa (over vlastníctvo).

### 1.3 Frontend (client-dashboard.html)
- Nová sekcia "👨‍👩‍👧 Moja rodina": zoznam detí, tlačidlo "+ Pridať dieťa" (modal meno+ročník).
- Pri rezervácii v schedule.html: ak má user deti, zobraz select "Pre koho rezervujem"
  (Ja / meno dieťaťa) — pošli `for_child_id`.
- Pri každom dieťati: jeho najbližšie rezervácie, stav členstva, QR na check-in.

### 1.4 Admin + tréner
- V admin CRM pri klientovi zobraz deti (badge "dieťa" + meno rodiča pri child profile).
- Trainer attendance vyhľadávanie (`/api/attendance/search-users`) musí nájsť aj deti.

### 1.5 Hotovo keď
- Rodič vytvorí dieťa, rezervuje zaňho hodinu, tréner ho odbaví, admin vidí prepojenie.
- `node --check` prejde, lokálny test celého flow prejde, commit + push.

---

## FÁZA 2 — Kurzy so zápisom (semestre)

**Prečo:** detské tance fungujú ako kurz september–december, nie drop-in.

### 2.1 Dátový model
- Nová kolekcia `db.courses` (`courses.db`): `{name, description, class_id (väzba na
  týždennú hodinu), start_date, end_date, price, capacity, active}`.
- Nová kolekcia `db.enrollments`: `{course_id, user_id, booked_by, status:
  'pending'|'paid'|'cancelled', paid_amount, payment_method, created_at}`.

### 2.2 Backend
- CRUD `/api/admin/courses` (adminAuth) + `GET /api/courses` (verejné, len aktívne).
- `POST /api/courses/:id/enroll` (auth, podpora `for_child_id`): kapacitný limit,
  duplicitný zápis zakázaný. Platba: PayPal order (`ref_type:'course'`) ALEBO
  `payment_method:'cash'` (status pending, admin potvrdí).
- Po zaplatení: enrollment `paid`, klient dostane notifikáciu + email (použi `emailTemplate`).
- Zapísaní na kurz majú automaticky "rezerváciu" na každú hodinu kurzu — NEgeneruj bookings
  dopredu; namiesto toho v attendance vyhľadávaní (`search-users` / QR check-in) uznaj
  aktívny enrollment ako platný vstup na danú `class_id`.

### 2.3 Frontend
- `pricing.html`: sekcia "Kurzy" (karty: názov, termín, cena, voľné miesta, Zapísať).
- `client-dashboard.html`: moje kurzy (aj detí).
- Admin: nová sekcia "Kurzy" (zoznam, zápisy, potvrdenie cash platby, obsadenosť).

### 2.4 Hotovo keď
- Admin vytvorí kurz, klient zapíše dieťa, zaplatí (alebo cash), tréner odbaví na hodine.

---

## FÁZA 3 — Úlohy a poznámky na profile klienta (Glofox "Tasks")

- Nová kolekcia `db.tasks`: `{user_id (klient), text, due_date, done, created_by, created_at}`.
- CRUD `/api/admin/tasks` (adminAuth aj trainerAuth na čítanie vlastných).
- V admin CRM detaile klienta: záložka Úlohy (pridať/odškrtnúť), zoznam "Dnešné úlohy"
  na admin Prehľade.
- Denný job: úlohy po termíne → notifikácia adminovi.

---

## FÁZA 4 — Zjednodušenie klientskeho flow + dizajn

**Cieľ:** klient všetko vybaví do 2 klikov; jednotný vizuál.

### 4.1 Client dashboard ako centrum
- Po prihlásení VŽDY na `/client-dashboard`. Hore: najbližšia hodina + tlačidlo QR,
  stav členstva/kreditov, 1-klik "Rezervovať znova" (posledná navštevovaná hodina).
- Skry sekcie, ktoré klient nepoužíva (partner/MLM veci zobraz len ak `user_type==='partner'`).

### 4.2 Vizuálna konzistencia
- Všetky stránky používajú `fa-theme.css` + `nav-bar.js` (skontroluj každú).
- Animácie: jemné fade-in pri načítaní kariet (CSS `@keyframes`, `animation-delay` kaskáda
  — vzor už existuje v `nav-bar.js` `faMoItemIn`), hover-lift na kartách, skeleton loading
  namiesto "Načítavam..." textov.
- Mobil: over všetko na šírke 375 px (appka je PWA, klienti sú na mobiloch).
- Po zmenách VŽDY zvýš SW cache verziu.

### 4.3 Onboarding nového klienta
- Po registrácii 3-krokový wizard (už čiastočne existuje v index.html — dokonči):
  1) vyber si hodinu (prvá zdarma), 2) stiahni appku (PWA install prompt), 3) hotovo.

---

## FÁZA 5 — Reporty a retencia navyše ✅ HOTOVO (2026-07-07)

> Implementované v `runDailyJobs()`: (5) win-back kupón po 30 dňoch bez návštevy –
> pripíše 1 free kredit + email + notifikácia, raz (flag `winback_sent`, resetuje sa
> pri ďalšej rezervácii); (6) týždenný admin report po pondelkoch – tržby, noví klienti,
> absolvované/no-shows, top/flop hodiny, expirujúce členstvá; email adminom + in-app
> notifikácia (funguje aj bez emailu). Manuálny trigger: `POST /api/admin/weekly-report/run`.
> Narodeninový benefit odložený (dospelí zatiaľ nemajú `birth_date`). Overené naživo.

### PÔVODNÁ ŠPECIFIKÁCIA
## FÁZA 5 (pôvodne) — Reporty a retencia navyše

- **Týždenný email adminovi** (pondelok 8:00, v `runDailyJobs` + kontrola dňa):
  tržby týždňa, noví klienti, obsadenosť top/flop 3 hodiny, no-shows, expirujúce členstvá.
- **Auto win-back kupón:** klient 30 dní bez návštevy → email s kódom na 1 hodinu zdarma
  (flag `winback_sent` na userovi, kupón = navýš `single_entries` o 1 pri návrate — jednoducho).
- **Narodeniny:** ak user má `birth_date`, pošli gratuláciu + malý benefit (pridaj pole
  do registrácie/profilu ako voliteľné).

---

## FÁZA 6 — Prevádzkové drobnosti

- `GET /healthz` endpoint (vráti `{ok:true}`) pre Railway healthcheck.
- Denná záloha: job o 3:00 skopíruje `*.db` do `DATA_DIR/backup/YYYY-MM-DD/`
  (drž max 7 dní, staršie zmaž).
- Rate-limit na `/api/login` a `/api/register` (jednoduchý in-memory počítadlom IP,
  max 10/min) — bez novej závislosti.
- Audit log admin akcií: kolekcia `db.audit` {admin_id, action, target, created_at},
  zapíš pri delete/block/platbách.

---

## FÁZA 7 — Najžiadanejšie funkcie z konkurencie (Mindbody, WellnessLiving, Momence, TeamUp)

Zoradené podľa pomeru hodnota / prácnosť. Implementuj v tomto poradí.

### 7.1 Míľniky a gamifikácia (retencia — "50. hodina" efekt)
- V daily jobs: keď `visit_count` klienta dosiahne míľnik (5, 10, 25, 50, 100),
  pošli gratulačný email + notifikáciu (dedup: flag `milestone_<n>` na userovi).
- V client-dashboarde: progress bar k ďalšiemu míľniku + odznaky (emoji badge
  🥉10 · 🥈25 · 🥇50 · 💎100). Čisto frontend z `visit_count`, žiadna nová kolekcia.

### 7.2 "Kto príde na hodinu" (social proof pri rezervácii)
- `GET /api/classes/:id` doplň `attendees_preview`: počet potvrdených na najbližší termín
  + prvé mená max 5 klientov, KTORÍ SÚHLASILI (nové pole `show_in_attendees:true`
  default true, vypínateľné v profile).
- V schedule.html pri hodine: "💃 Ide 8 ľudí: Katka, Mirka, +6".

### 7.3 Zmena/zrušenie hodiny → automatické upozornenie rezervovaným
- `PUT /api/admin/classes/:id`: ak sa zmení `time_start`, `location` alebo `active:false`,
  nájdi všetky budúce confirmed bookings tej hodiny a pošli email + notifikáciu
  ("Hodina X sa presúva / ruší"). Pri zrušení hodiny vráť klientom vstup
  (`single_entries + 1`, ak platili vstupom).

### 7.4 Intro ponuka pre nováčikov
- Do `MEMBERSHIP_PLANS` pridaj `intro` plán (napr. "Prvý mesiac za 29 €", `intro_only:true`).
- `POST /api/membership/buy|subscribe`: `intro_only` plán povoľ len userom bez
  predchádzajúceho členstva (check v `db.memberships` s `!m._type`).
- Na pricing.html zvýrazni intro kartu len neprihláseným/novým (podľa `/api/me`).

### 7.5 Záchrana zlyhaných platieb (dunning — Momence/Mindbody killer feature)
- PayPal webhook: spracuj `BILLING.SUBSCRIPTION.PAYMENT.FAILED` a `BILLING.SUBSCRIPTION.SUSPENDED`
  → email klientovi "platba neprešla, aktualizuj kartu" (link na PayPal) + notifikácia
  adminovi + flag `payment_failed_at` na userovi.
- Denný job: ak `payment_failed_at` > 3 dni a stále bez platby → druhý email;
  > 7 dní → označ membership `suspended` + admin notifikácia.

### 7.6 Darčekové poukazy
- Kolekcia `db.vouchers`: `{code (8 znakov), type:'entries'|'amount', value, buyer_email,
  recipient_name, redeemed_by, redeemed_at, paid, created_at}`.
- `POST /api/vouchers/buy` (verejné, PayPal `ref_type:'voucher'`): po zaplatení email
  s kódom kupujúcemu.
- `POST /api/vouchers/redeem` (auth): pripíše vstupy (`single_entries += value`)
  alebo kredit (`referral_credit += value`). Admin zoznam v sekcii Členstvá.

### 7.7 Kiosk režim check-inu (tablet na recepcii)
- Nová stránka `/kiosk` (trainerAuth cez PIN v URL alebo prihlásený tréner):
  celoobrazovkový QR skener (použi existujúcu logiku z trainer.html
  `/api/attendance/qr-checkin`) + veľké potvrdenie "✅ Vitaj, Katka!".
- Klientom sa tak netreba hlásiť u trénera — self-service ako Mindbody.

### Zámerne vynechané (nepomer hodnota/prácnosť pre malú školu)
- Consumer marketplace (Mindbody ClassPass štýl) — nemáme objem.
- Dynamic pricing — zbytočná komplexita pri cenách 9–10 €.
- Natívna iOS/Android appka — PWA stačí; nerob.
- SMS brána — drž email + push notifikácie, SMS až keď užívateľ vyslovene požiada.

## FÁZA 8 — Marketing & Finance modul (ERP/CRM) — zadanie používateľa 2026-07-09

> Cieľ: modul na úrovni Stripe Dashboard + HubSpot + Glofox. Implementuj po častiach,
> každú časť otestuj a commitni samostatne. Časti A–C sú HOTOVÉ ✅ (2026-07-09), pokračuj D+.

### A) Fakturácia ✅ HOTOVO
> `db.invoices` (unikátne číslo RRRRNNNN = VS, SK náležitosti, dodávateľ z env
> COMPANY_NAME/ADDRESS/ICO/DIC/ICDPH/IBAN), auto-vystavenie pri každej úspešnej platbe
> (Stripe one-time/sub/obnova/shop, PayPal capture/sub/obnova, cash membership, vstup),
> tlačiteľná stránka /invoice/:number (print→PDF), admin sekcia Faktúry (filtre rok/mesiac/
> klient/stav, CSV export, storno, dobropis), email potvrdenie o zaplatení s linkom.

### B) Finančný dashboard ✅ HOTOVO
> /api/admin/finance/stats?from&to + admin sekcia Financie: obraty (deň/mesiac/rok/celkovo),
> MRR/ARR (aktívne subscriptions), AOV, priem. hodnota klienta, noví členovia, nové členstvá,
> expirované bez obnovy, graf príjmov (Chart.js), filtre dnes/včera/týždeň/min.týždeň/
> mesiac/min.mesiac/vlastný interval.

### C) Audit log ✅ HOTOVO
> `db.audit` insert-only: kto/kedy/čo/pred/po/dôvod/IP. Hooky: storno, dobropis, adspend,
> úprava platby. GET /api/admin/audit + tabuľka v admin sekcii Audit.

### D) Kampane rozšírené (TODO)
- db.campaigns: {name, platform(FB/IG/Google/TikTok/Email/SMS/Referral/Organic/Iné),
  date_from/to, budget, goal, note, spend, clicks, registrations, first_visits, memberships}
- admin CRUD UI v Marketing skupine; auto-metriky: CTR, ConvRate, RegRate, VisitRate,
  MembershipConv, CPC, CPR, CPV, CPM(membership), ROAS=rev/cost, ROI=(profit/cost)*100,
  CAC per kampaň. Revenue kampane = tržby klientov s utm_campaign == kampaň (atribúcia
  už existuje na useroch). LTV podľa kampane do /api/admin/marketing/stats.

### E) Rozšírené metriky (TODO)
- LTV podľa mesta / typu členstva (rozšíriť marketing/stats)
- Churn = zrušené členstvá / všetci členovia; Retention po 30/60/90/180/365 dňoch
  (kohorty podľa created_at, aktivita = booking v okne); Payback period = CAC / priem.
  mesačná útrata.

### F) CRM detail klienta (TODO)
- endpoint /api/admin/crm/client/:id: total paid, návštevy, priem. návštevnosť/mes.,
  posledná návšteva, top štúdio, top inštruktor, LTV, história platieb/členstiev/rezervácií.
- UI: klik na klienta v CRM otvorí detail panel.

### G) Účtovníctvo (TODO)
- exporty: CSV/Excel(xlsx cez SheetJS CDN v admin)/XML/ISDOC (ISDOC = CZ/SK e-faktúra XML
  schéma — generuj minimálny validný doklad); mesačné/ročné uzávierky (agregácie);
  príjmy podľa štúdia/mesta/inštruktora/typu členstva; DPH prehľad (ak COMPANY_ICDPH).
- QR platba (PAY by square) pre neuhradené faktúry — lib "bysquare" alebo vlastný encoder.

### H) Automatické emaily — doplniť chýbajúce (TODO)
- existujú: registrácia, po kúpe členstva (potvrdenie+faktúra), pred koncom, po prvej
  hodine, win-back, rezervácia potvrdená.
- doplniť: po skončení členstva, po neúspešnej platbe (Stripe invoice.payment_failed
  webhook), po storne/refunde, po zrušenej rezervácii.

### I) Reporty výkonu trénerov (TODO — spec užívateľa sekcia 13)
- /api/admin/trainers/performance?from&to&city&trainer: odučené hodiny (bookings
  attended zoskupené podľa class+date), klienti, priem. obsadenosť, tržby z hodín
  (transactions/payments cez bookings), noví vs opakovaní klienti, no-shows, storná,
  priem. príjem/hodina, porovnanie s minulým obdobím; odporúčania (top/flop hodiny).
- admin sekcia Tréneri s filtrami.

### J) Výplaty trénerov (TODO — sekcia 14)
- db.payout_rules per tréner: {trainer_id, fixed_per_class, pct_of_revenue, per_client,
  bonus_full_class, bonus_new_member}; db.payouts: {trainer_id, month, base, bonuses,
  deductions, total, status: draft/approved/paid/held/cancelled, history:[]}.
- auto-výpočet z dochádzky; admin úprava s poznámkou (zapíš do history + audit);
  exporty PDF(print)/CSV.

### K) Refundácie (TODO — sekcia 15)
- db.refunds: {payment_id, type: full/partial/storno/credit_note/app_credit/transfer,
  amount, reason(enum), note, created_by}; Stripe refund cez API (POST /v1/refunds),
  PayPal cez /v2/payments/captures/{id}/refund; app_credit → user.referral_credit.
- každý refund: audit + dobropis + email klientovi + záznam v CRM histórii.
- štatistiky: refund rate, podľa dôvodu/trénera/mesta/kampane; admin notifikácie
  (vysoký počet, nad sumu, opakované u klienta).

### L) Admin notifikácie & alerty (TODO — sekcia 11)
- denný job: zlyhané platby, končiace členstvá (existuje), prekročený rozpočet kampane,
  CAC ↑ / ROAS ↓ / LTV ↓ medzimesačne, churn spike, X dní bez platby → notifikácia adminom.

### M) Exporty jedným klikom (TODO — sekcia 10)
- admin sekcia Exporty: účtovníctvo/faktúry/platby/členovia/marketing/CRM/finance/
  manažérsky report — CSV + XLSX (SheetJS).

### Architektúra (drž sa!)
- Všetky platobné záznamy v db.payments s poľom `provider` ('stripe'|'paypal'|'manual'|
  'cash') — nové brány (GoPay, GP WebPay…) = nový provider, rovnaká schéma.
- Ad platformy: db.campaigns.platform + budúce API importy plnia rovnaké polia
  (spend/clicks/…): Meta Ads API, Google Ads API len nahradia ručné zadávanie.
- Faktúry NIKDY nemazať, len status (paid/cancelled/credited) + dobropisy.
- Audit log je insert-only.

## Čo NEROBIŤ

- Neprepisuj architektúru (žiadny framework, žiadna migrácia z NeDB) — funguje to.
- Nepridávaj marketingové stránky do appky (sú na webe).
- Nemeň PayPal integráciu, len ju rozširuj (ref_type pattern).
- Neposielaj emaily bez deduplikácie (vzor: notifikácia typu X existuje → skip).
- Nezabúdaj na SW cache bump — najčastejšia príčina "nefunguje to" u klientov.

## Postup pri každej úlohe (checklist)

1. Prečítaj relevantnú časť `server.js` / HTML súboru PRED úpravou.
2. Implementuj minimálne a konzistentne s existujúcim štýlom kódu.
3. `node --check server.js`.
4. Spusti lokálne, otestuj celý flow cez fetch/prehliadač ako admin aj klient.
5. Zmaž testovacie dáta, ktoré si vytvoril.
6. Zvýš SW verziu, ak si menil frontend.
7. `git add` (konkrétne súbory) → commit → push.
8. Krátko zhrň užívateľovi po slovensky, čo je hotové a ako to otestuje.
