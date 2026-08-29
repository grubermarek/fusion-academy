# FUSION ACADEMY — CUSTOMER JOURNEY MASTER
**Source of truth pre celý funnel.** Pred každou prácou na funneli si tento dokument prečítaj; po každej významnej zmene ho aktualizuj (CURRENT STATE → TODO → CHANGELOG → DECISION LOG). Ak dokument nesedí s kódom, over kód a dokument oprav.

Posledná aktualizácia: **2026-08-25** (audit, žiadna implementácia)
Cieľový funnel: META AD → LANDING → REGISTRÁCIA → 1. REZERVÁCIA → ÚČASŤ → NÁKUP → 2. NÁVŠTEVA → ČLENSTVO → RETENCIA → REFERRAL

⚠️ **Repo `grubermarek/fusion-academy` je VEREJNÉ.** Tento dokument zatiaľ NIE JE commitnutý — obsahuje biznis stratégiu. Rozhodnutie: commitnúť / gitignore / spraviť repo private → čaká na Mareka.

---

## 1. CURRENT SYSTEM MAP (stav k 25. 8. 2026)

| Krok | Stav | Poznámka |
|---|---|---|
| META reklama | 🟡 | Bežia kampane (HEJ BABY → /registracia, Masterclass → event). Acquisition kreatíva „prvá hodina zadarmo" per mesto NEEXISTUJE. Spend ručne (⚠ SPEND STALE badge funguje). |
| Landing | ✅ | /prva-hodina?city=detva|zvolen|banska-bystrica|brezno — hero per mesto, 3 kroky, reálne recenzie, najbližšie termíny, rezervácia bez hesla (konto na pozadí), .ics kalendár, fa-track + fbq Lead/Schedule. |
| Atribúcia | ✅ | `fa-track.js` first-touch (localStorage `fa_attr`, neprepisuje sa) + registration-touch pri registrácii (utm_*, fbclid, gclid, landing_page, referrer). `account_creation_type`, `registration_at(+source)`, `lead_at` + backfill. Event objednávky ukladajú UTM snapshot (`ev_orders.attr`). |
| Registrácia | ✅ | Modál (meno/e-mail/heslo/telefón) + Google sign-in + guest invite (bez hesla). Málo polí ✓. |
| Registrácia → 1. rezervácia | ✅ | Po registrácii redirect na dashboard + welcome guide; chýba dominantný krok „VYBER SI PRVÚ HODINU (tvoje mesto, najbližšie termíny)". Staff dostane úlohu „nová registrácia bez rezervácie" (computeUrgentTasks) ✓, klientka sama silný nudge nemá. Sekvencie lead_nurture bežia pre leady. |
| Potvrdenie rezervácie | 🟡 | Mail potvrdenie existuje; obrazovka „MÁŠ TO 🎉 + čo si priniesť + do kalendára" čiastočná (welcome guide), Pridať do kalendára chýba. |
| Reminder deň pred | ✅ | Mail „Zajtra máš hodinu" — opravené cielenie (len zajtrajšie rezervácie, skôr sa brali všetky rezervácie hodiny bez dátumu) + skip zrušených hodín. |
| Reminder v deň hodiny | ✅ | In-app notifikácia „💃 Dnes tancuješ!" v dennom jobe (guard per booking). |
| Check-in / attendance | ✅ | Kiosk QR (výber hodiny pri dvoch, preferencia rezervácie), tréner smart zápis, online auto — **všetko cez `creditAttendance()`** (centrálne ✓), lead→client promotion pri účasti ✓. `attendance_status` (pending/attended/no_show/unknown), no-show job 60 min po hodine + notifikácia (od 23. 8.). ⚠️ `no_show` NIKDY nejde do `status`. |
| Tréner vidí prvýčku | ✅ | Badge „🌟 PRVÁ HODINA — privítaj ju" v trénerskom zápise (visit_count=0). |
| Post-class conversion | ✅ | Večerný CRM P2 job: po PRVEJ účasti mail „Ako sa ti páčila?" — bez členstva: **20 % kupón na 1. mesiac, platí 48 h** (`PRVA-XXXX`), s členstvom: feedback verzia. Idempotentné (`first_class_followup_sent`). trial_followup sekvencia (deň 9 = 2. návšteva push, žiadna ďalšia zľava — schválené). |
| Pricing / checkout | ✅/🟡 | `/pricing` + Stripe subscriptions/one-off; promo kódy (PRVYMESIAC, VITAJSPAT, PRVA-*). Checkout jednoduchosť neauditovaná do hĺbky. |
| Abandoned checkout | ✅ | In-app karta + mail „Tvoje členstvo ešte nie je dokončené" 3–48 h po pending Stripe checkoute (revalidácia zaplatenia, dedupe na platbe, p6). |
| Po nákupe → 2. rezervácia | ✅ | Karta „Členstvo máš aktívne 🎉 — vyber si, kedy prídeš najbližšie" na dashboarde + mail 3–48 h po prvom platenom členstve bez budúcej rezervácie (revalidácia, dedupe). |
| Retencia / win-back | ✅/🟡 | Sekvencie winback (multi-step), reengagement, expiry warnings; coach winback + „mesiac po členstve" úlohy; Churn Risk sekcia v admine. Segmentácia podľa poslednej aktivity čiastočná, mestá v textoch áno. |
| Referral | ✅ | Invite linky, guest booking, kredity/odmeny, taška kampaň, ambasádorský program (samostatný). Atribúcia referral_events ✓. |
| Meranie | ✅ | Funnel dashboard (reg→book→attend→2nd→pay, mediány, mestá, kampane, klikacie zoznamy, rebuildFunnelStamps) + CAC→LTV kohortový dashboard (definície nižšie) + Kampane + Fusion AI brief. |
| Pixel/CAPI | ✅ | event_id dedup Pixel↔CAPI (faEventId → attribution.event_id → CAPI event_id = fbq eventID). CAPI eventy: CompleteRegistration, Lead+Schedule (landing), InitiateCheckout (membership `ic_<stripe_session>` + vstupenky `ic_<order>`), Purchase (membership `pur_<stripe_session>`, vstupenky `pur_<order>` — idempotentné cez webhook aj return), custom FirstClassAttended (`fca_<uid>`, obe cesty: creditAttendance + manual-booking). QA hook: CAPI_DEBUG_FILE. |
| E-mail infra | ✅/🟡 | Globálny denný budžet s prioritami PRIAMO v sendMail (p1–2 transakčné do 295 · p3 remindery 285 · p4 270 · p5 konverzné 255 · p6–7 240 · p8–9 nurture 225 · p10 marketing 200) — marketing nikdy nevyhladuje transakčné. Priority nastavené na sekvenciách, reminderoch, expiry, nudge, event kampani, resete hesla. Zostáva: click/conversion tracking mailov (FUNNEL-012). |
| Eventy (vstupenky) | ✅ | Samostatný funnel (event modul, QR, check-in, affiliate, tržby v účtovníctve, UTM na objednávkach). Nemieša sa s membership acquisition ✓. |
| Online | ✅ | Samostatný funnel (online.html, streamy, členstvá online, entry režim). |
| Deti | ✅ | child účty (`is_child`, parent väzba), `account_creation_type='child'`, mimo kohort; attendance dieťaťa nejde rodičovi (child booking flag). |

---

## 2. DÁTOVÝ MODEL — SOURCE OF TRUTH

- **bookings** = pravda o rezerváciách a účasti (`status`: pending/confirmed/attended/cancelled — no_show NIKDY; `attendance_status`: pending/attended/no_show/unknown; `attended_at/by`, `access_method`, `free_class`, `entry_collected`).
- **payments (Stripe) + transactions (hotovosť/vstupy/privátky/event_ticket) + memberships(payment_method)** = pravda o revenue. `accountingData()` ich spája (jediný zdroj pre tržby, bez dvojitého počítania faktúr).
- **users** = identita + akvizícia: `account_creation_type` (self_registration | guest_invite | meta_leadform | import | admin | child), `registration_at` + `registration_at_source` (actual | backfill_created_at), `lead_at`, `utm_*`, `fbclid`, `gclid`, `landing_page`, `referrer`, `lead_source`. **Prvý dotyk sa NEPREPISUJE.**
- **funnel timestampy** = cache; `rebuildFunnelStamps()` ich prepočítava zo source dát pred zobrazením (source-of-truth ostávajú bookings/payments).
- **campaigns** = spend (`spend_updated_at`, stale>7 dní), utm_key (prefix) / lead_source_key / gclid_attr.
- **mail_log** = odoslané maily + open pixel. **email_queue** = sekvenčné kroky (bez globálnych priorít).
- Behaviorálne eventy: referral_events, shop_events (čiastočné). Jednotný event log NEEXISTUJE — rozhodnuté: stavy odvodzovať zo source dát, event log len ak bude reálne treba (viď DECISION LOG).

## 3. ATRIBUČNÉ PRAVIDLÁ (záväzné)

1. UTM/first-touch pri registrácii sa nikdy neprepisujú neskoršou návštevou.
2. meta_leadform = **lead** (lead_at; nie registrácia). glofox/oldlist = **import** → NIKDY v akvizičných kohortách.
3. guest invite = **registrácia** (`guest_invite`, registration_at = odoslanie formulára); kanál drž oddelene (referral + sponsor).
4. acquisition_at = registration_at ‖ lead_at ‖ created_at. First-touch sa spätne nevymýšľa (null ostáva null).
5. Aktivácia = 1. reálna účasť. Payer = 1. nenulová platba. Member = platené členstvo (price>0, nie gift/migrated). `first_payment` ≠ `first_membership` (10 € vstup nie je membership konverzia).
6. Kohorta kampane: match cez utm_key prefix / lead_source_key / gclid; Revenue30/90 od acquisition_at; kampaň INCOMPLETE kým kohorta nemá 90 dní.
7. Revenue typy interne rozlišovať: entry / membership / pass / shop / event_ticket / private (transactions.type to už nesie).

## 4. CUSTOMER STATES (IMPLEMENTOVANÉ — /api/my-state, odvodené, neukladané)

Zdroj: timestampy zo source dát (bez duplicitného stringu v DB).

| Stav | Podmienka | Primary CTA | Automation | Exit |
|---|---|---|---|---|
| VISITOR | bez účtu | Rezervuj 1. hodinu | — | registrácia |
| REGISTERED_NO_BOOKING | registration_at ∧ žiadny booking | VYBER SI PRVÚ HODINU (mesto) | mail D0+2h, D2 (stop pri bookingu) | 1. booking |
| FIRST_BOOKED | 1 booking, 0 attended | detail hodiny + čo si priniesť | reminder D-1, push D0 | attended / no_show |
| FIRST_NO_SHOW | 1. booking no_show | VYBER SI NOVÝ TERMÍN | no-show mail (nie trestajúci) | attended |
| FIRST_ATTENDED_NO_PURCHASE | first_attended ∧ bez platby | ponuka + countdown 48 h (server-side) | 20 % kupón (existuje) | platba |
| NEW_CUSTOMER | platba ∧ <2 attended | KEDY TANCUJEME NABUDÚCE? | 2nd-booking mail | 2. účasť |
| ACTIVE | členstvo/permanentka + chodí | najbližšia hodina / rezervuj | — | pokles aktivity |
| AT_RISK | days_since_last_attendance > prah (z dát) ∧ !future_booking | Pozri najbližšie termíny v {mesto} | winback (existuje) | návrat |
| CHURNED | členstvo skončilo + neobnovila + nechodí | comeback ponuka | winback/lapsed (existuje) | návrat |

## 5. EMAIL AUTOMATION MAP (existujúce)

| Trigger | Segment | Mail | Stop podmienka | Stav |
|---|---|---|---|---|
| registrácia | všetci | welcome sekvencia | — | ✅ |
| lead bez návštevy | lead_nurture | „príď zadarmo" multi-step | membership/1. návšteva → cancel | ✅ |
| 1. návšteva (večer 20:00) | bez členstva | „Ako sa ti páčilo?" + 20 % kupón 48 h | first_class_followup_sent; už-má-členstvo variant bez kupónu | ✅ |
| 1. návšteva, nekúpila | trial_followup | D2/D5/D9 (D9 = 2. návšteva, bez zľavy) | kúpila/entry → cancel | ✅ |
| deň pred hodinou | s rezerváciou | „Zajtra máš hodinu" | zrušená rezervácia | ✅ (overiť dedupe) |
| expirácia členstva | končí o 7/3/1 | obnov si | obnovila | ✅ |
| neaktivita | winback multi-step (7→300 d) | rôzne + VITAJSPAT | návrat/optout | ✅ |
| meta leady | meta_lead_zumba D0/D3/D7 | hodina zdarma v {mesto} | návšteva | ✅ |
| event predaj | kupujúca | vstupenky QR | — | ✅ (transakčný) |
| event kampaň | členky+klientky | pozvánka (dávkované 240/deň) | poslané raz (mail_log dedup) | ✅ |
| **abandoned checkout** | pay_pending | — CHÝBA mail | platba prebehla | 🔴 |
| **po nákupe → 2. rezervácia** | NEW_CUSTOMER | — CHÝBA | 2. booking | 🔴 |
| **reg bez bookingu (self)** | REGISTERED_NO_BOOKING | čiastočne cez lead_nurture | booking | 🟡 |

Zásada (platí, vynucovať v každom jobe): pred odoslaním znovu načítať stav; job má dedupe (settings flag / user flag / mail_log subject); guard na konverziu.

## 6. DECISION LOG

```
2026-08-23  Guest invite = registrácia (account_creation_type=guest_invite). SCHVÁLENÉ (audit s ChatGPT).
2026-08-23  meta_leadform = lead (lead_at), NIE registrácia; glofox/oldlist = import mimo kohort. SCHVÁLENÉ.
2026-08-23  acquisition_at fallback = registration_at; first-touch sa spätne nevymýšľa. SCHVÁLENÉ.
2026-08-23  Multi-touch atribúciu pri desiatkach konverzií NEROBIŤ (falošná presnosť). SCHVÁLENÉ.
2026-08-23  no_show sa nikdy nezapisuje do bookings.status (zhodilo appku) — len attendance_status. SCHVÁLENÉ.
2026-08-23  Maily len z produkcie (NODE_ENV/RAILWAY_ENVIRONMENT). SCHVÁLENÉ.
2026-08-23  trial_followup D9 bez zľavy (učila čakať na lacnejšiu ponuku); 20 % kupón po 1. hodine ostáva jediná zľava. SCHVÁLENÉ.
2026-08-25  Customer state NEukladať ako string — odvodzovať zo source timestampov. NÁVRH (čaká na Mareka).
2026-08-25  Jednotný event log zatiaľ NEzavádzať; stavy a funnel idú zo source dát. NÁVRH.
2026-08-25  FREE vs PAID acquisition experiment — samostatné campaign keys, nemiešať používateľky ani post-class ponuky. NÁVRH.
2026-08-25  Post-purchase prompt: NIE „Kedy tancujeme nabudúce?“ (znie divne).
            Headline: „Členstvo máš aktívne 🎉 — vyber si, kedy prídeš najbližšie.“
            CTA: „REZERVOVAŤ ĎALŠIU HODINU“. SCHVÁLENÉ (Marek).
2026-08-25  Ceny sa v experimentoch NEVYMÝŠĽAJÚ — každá nová cena vyžaduje Marekov súhlas. ZÁSADA.
2026-08-25  FREE vs PAID experiment ODLOŽENÝ — Marek: nevie si predstaviť A/B s platenou aj
            free hodinou naraz, nie je rozpočet na toľko kampaní. Build (FUNNEL-015) sa
            nespúšťa; offer dimenzia v CAC dashboarde ostáva pripravená a nič nestojí.
            Akvizícia zatiaľ len FREE funnel → /prva-hodina. ROZHODNUTÉ (Marek).
2026-08-25  Prerobenie kampaní na landing — HOTOVÉ (Marek: „prepracuj kampane"):
            · Google FA Zumba Search 3.0: cieľ z homepage na /prva-hodina?city=zvolen
              &utm_source=google&utm_medium=cpc&utm_campaign=fa-zumba-search-30,
              zobrazená cesta /prva-hodina. Uložené (Marek potvrdil identitu).
            · Meta FA — Video HEJ BABY (jediná aktívna akvizičná; 4 mestá): cieľ
              z /registracia na /prva-hodina?utm_source=fb&utm_medium=cpc
              &utm_campaign=fa-video-hej-baby (bez city — návštevníčka si mesto vyberie).
              Publikované, reklama v Meta review.
            · NÁLEZ: stará reklama posielala fa-video-hejbaby (bez pomlčky) — kliky sa
              NEpárovali s kampaňou fa-video-hej-baby. Fix: migrácia hejbaby_utm_prefix_v1
              → utm_key = prefix fa-video-hej (chytí obe podoby). Nasadené, potvrdené v logu.
            · Eventové kampane (Latin Tropical ×2) zostali bez zmeny — cielia na vstupenky.
            · Meta „Čoskoro sa môže vyžadovať overenie" banner + Google overenie inzerenta
              (deadline 15. 9.) — VYBAVIŤ MAREK.
```

## 7. TODO REGISTER

```
FUNNEL-001  P0  Reg → Booking: po registrácii bez bookingu okamžite ukázať najbližšie termíny v jej meste (dashboard hero + mail D0+2h).
            Dopad 5/5  Námaha 2/5  Riziko 1/5  Metrika: registration→first_booking %, medián minút.  DONE (2026-08-25)
FUNNEL-002  P0  City acquisition landing /prva-hodina?city=X (zovšeobecniť guest-invite flow, bez sponzora): hero, 3 kroky, termíny, 1 CTA, fa-track.
            Dopad 5/5  Námaha 2/5  Riziko 2/5  Metrika: LP→booking %.  DONE (2026-08-25)
FUNNEL-003  P0  In-app push v deň hodiny + overiť/doplniť dedupe day-before remindera.
            Dopad 3/5  Námaha 1/5  Riziko 1/5  Metrika: booking→attendance %, no-show %.  DONE (2026-08-25)
FUNNEL-004  P0  Po aktivácii členstva „KEDY TANCUJEME NABUDÚCE?" (obrazovka + mail; segment purchased_no_next_booking).
            Dopad 4/5  Námaha 2/5  Riziko 1/5  Metrika: first_purchase→second_booking %.  DONE (2026-08-25)
FUNNEL-005  P0  CAPI: event_id dedup s Pixelom + eventy Lead, InitiateCheckout, Purchase(všetky typy revenue), custom FirstClassBooked/Attended.
            Dopad 4/5  Námaha 3/5  Riziko 2/5  Metrika: Meta Events Manager dedup %, kvalita optimalizácie.  DONE (2026-08-25)
FUNNEL-006  P0  Centrálna mail queue: email_jobs (priority 1–10, dedupe_key, revalidácia pred send, denný Brevo budžet globálne).
            Dopad 4/5  Námaha 3/5  Riziko 2/5  Metrika: 0 nedoručených transakčných mailov, podiel limitu na marketing.  DONE (2026-08-25)
FUNNEL-007  P1  State-based home (NEXT BEST ACTION): jeden dominantný CTA podľa customer state (sekcia 4).
            Dopad 5/5  Námaha 3/5  Riziko 2/5  Metrika: state→next-step konverzie.  DONE (2026-08-25)
FUNNEL-008  P1  Abandoned checkout mail (Stripe session bez platby, revalidácia, 1×).
            Dopad 3/5  Námaha 2/5  Riziko 1/5  Metrika: checkout→purchase recovery %.  DONE (2026-08-25)
FUNNEL-009  P1  Tréner: badge „PRVÁ HODINA" pri klientke v zápise + skript privítania.
            Dopad 3/5  Námaha 1/5  Riziko 1/5  Metrika: first_attended→second_attended %.  DONE (2026-08-25)
FUNNEL-010  P1  Feedback 1 otázka (hviezdičky) po 1. hodine in-app; vetvenie low/high.
            Dopad 2/5  Námaha 2/5  Riziko 1/5  Metrika: response rate, korelácia s konverziou.  DONE (2026-08-25)
FUNNEL-011  P1  Potvrdenie rezervácie: „Pridať do kalendára" (.ics) + čo si priniesť.
            Dopad 2/5  Námaha 1/5  Riziko 1/5  Metrika: attendance rate.  DONE (2026-08-25)
FUNNEL-012  P1  Mail click-tracking (redirect /api/mail/click/:id) + conversion attribution mailov (sent→clicked→purchased→revenue per template).
            Dopad 3/5  Námaha 2/5  Riziko 1/5  Metrika: revenue per template.  DONE (2026-08-25)
FUNNEL-013  P1  Cancellation reasons pri rušení členstva (výber dôvodu, ukladať).
            Dopad 2/5  Námaha 2/5  Riziko 1/5  Metrika: churn dôvody rozpad.  DONE (2026-08-25)
FUNNEL-014  P2  CAC dashboard v2: payback, retention D30/60/90, offer dimension (free vs paid).
            Dopad 3/5  Námaha 3/5  Riziko 1/5  Metrika: LTV:CAC per kampaň.  DONE (2026-08-25)
FUNNEL-015  P0  FREE vs PAID experiment build (viď sekcia 8).
            Dopad 5/5  Námaha 4/5  Riziko 2/5  Metrika: cost per new paying member, D30/60/90 rev/acquired.
            ODLOŽENÉ (25. 8. 2026, Marek) — nie je rozpočet na paralelné kampane free+paid.
            Infra pripravená (offer dimenzia v CAC dashboarde), build sa spustí na Marekov pokyn.
```

## 8. EXPERIMENT REGISTER

```
EXP-001  FREE vs PAID first class
  Hypotéza: platený prvý vstup (existujúca cena 10 €) prinesie menej leadov, ale kvalitnejšie
  zákazníčky (nižší no-show, vyšší purchase intent) a lepší cost per paying member.
  Variant A: zumba_{city}_free_trial  (existujúci funnel, prvá hodina zadarmo)
  Variant B: zumba_{city}_paid_intro  (vstup 10 € — existujúca cena, žiadna nová)
  Nemiešať používateľky ani post-class ponuky (acquisition_offer na účte).
  Primárna metrika: cost per new paying member; sekundárne: cost per first attended,
  attendance→membership, D30/60/90 revenue per acquired, no-show %.
  Status: DEFERRED (25. 8. 2026 — Marek: bez rozpočtu na paralelné kampane; spustí sa na jeho pokyn)

EXP-002  Hero copy: „Prvá hodina zdarma" vs „Vyskúšaj Zumbu zdarma“ — metrika LP→booking.  PLANNED (po FUNNEL-002)
EXP-003  Kreatíva: video reálnej hodiny vs testimonial — metrika cost/first attended.  PLANNED
EXP-004  Poradie: výber termínu pred registráciou vs po — metrika LP→attended.  PLANNED (landing to už bude mať — guest flow = termín najprv)
```

**FREE vs PAID — technický rozsah (FUNNEL-015):**
1. `acquisition_offer` na user (free_first_class | paid_first_class) — set z landing variantu; immutable.
2. Paid landing variant `/prva-hodina?city=X&v=paid`: cena 10 € viditeľná, výber termínu → meno/kontakt → Stripe checkout (reuse event-checkout pattern) → booking CONFIRMED až po zaplatení (webhook), inak pending+abandoned mail.
3. Kampane: `zumba_{city}_paid_intro` utm_key v admin Kampaniach (spend ručne / insights sync).
4. Post-class vetvenie podľa acquisition_offer (paid ponuka = NÁVRH, schvaľuje Marek — žiadne nové ceny bez súhlasu).
5. Dashboard: FREE|PAID stĺpce (KPI tabuľka zo zadania §19) — rozšírenie /api/admin/cac-ltv o offer dimension.
6. Purchase 10 € = first_payment, NIE membership konverzia (pravidlo 5 v sekcii 3).

## 9. ZNÁME RIZIKÁ / KONFLIKTY

- Brevo limit: event ticker má vlastný budžet, ale sekvencie a CRM joby ho nekoordinujú → transakčný mail môže teoreticky naraziť na limit (rieši FUNNEL-006).
- ~~CAPI bez event_id: browser Pixel + server CAPI môžu duplikovať konverzie~~ → vyriešené (CHANGE-006). Pozor pri nových eventoch: vždy posielať event_id na obe strany.
- Test-filter `/test/i` vyhadzuje aj priezviská s „test" (Testová) — pri QA menách nepoužívať „test" v mene reálnej klientky; zvážiť presnejší filter.
- Reklamy dnes vedú na homepage — veľa CTA, veľa rozhodnutí (rieši FUNNEL-002).
- day-before reminder: overiť dedupe guard (nezistené do hĺbky).

## 10. CHANGELOG

```
CHANGE-015b 2026-08-28  ⏱ Časovač práce trénera
  V „Môj deň" widget: ▶ Spustiť / ⏹ Zastaviť a zapísať. Čas meria SERVER
  (štart v users.coach_timer_start — prežije refresh aj iné zariadenie).
  Stop → úloha „⏱ Odpracovaný čas: X h Y min" (coach_tasks, source timer,
  auto-schválená) + bonusové body: 1 b./30 min (coach_config
  timer_points_per_30min), bodovaný strop 240 min/deň (timer_daily_cap_min),
  session strop 8 h (zabudnutý časovač). Body idú do denného súčtu, boardu
  aj care-reportu automaticky (sú to coach_tasks body).
  QA hook: QA_TIMER_FAST=1 (1 s = 15 min). QA: qa/coach-timer.test.js 16/0,
  coach regresia 83/0.

CHANGE-015  2026-08-28  PLATOBNÝ LINK trénera + admin hub AMBASÁDORI + odklady
  · DEAL LINK: tréner sa dohodne telefonicky → na karte leadu „💳 Platobný link"
    → vyberie produkt (vstup/permanentka/Bronze/Silver/Gold/Kids/Online) → appka
    vytvorí unikátny odkaz /kupa/<token> (7 dní, jednorazový) + hotovú správu na
    poslanie. Klient klikne → prehľadná stránka s menom a cenou → Stripe checkout
    BEZ prihlásenia — nákup padne na JEHO profil (metadata user_id, fulfillment
    cez existujúci fulfillStripeCheckout). Cenové pravidlá appky platia (custom
    price, Gold permanentka 70 €). Členstvá cez link = jednorazové (žiadny odber
    bez súhlasu v appke). Po zaplatení: kontakt „booked" + poznámka do timeline,
    AUTOMATICKÁ KONVERZIA pod trénera (len ak klient nemá reálneho ne-admin
    sponzora — kradnutie nemožné) so zdôvodnením, notifikácia trénerovi aj
    adminom, provízia cez awardPurchaseCommission → objem/body v ambasádorskej
    sekcii automaticky. QA hook: STRIPE_FAKE=1 checkout vytvorí pending payment
    fake_deal_<token> → webhook test prebehne celý fulfillment E2E.
  · ADMIN HUB AMBASÁDORI (nová sekcia): tím s výkonmi za 30 dní (kontakty,
    záujem, konverzie, veľkosť línie, objem línie €, body), prihlášky na
    školenie (rentals amb_training) so spárovaním na účet + „✅ Absolvovala"
    + „🔥 Ambasádorka" jedným klikom, udelenie prístupu podľa mena/e-mailu.
    ZJEDNOTENÉ: ambasádorský prístup = user_type ambassador ALEBO is_assistant
    ALEBO tréner/admin (predtým coach batchy len pre asistentky a /ambasador
    len pre user_type — duálne). Migrácia grant_iveta_ambassador_v1: Iveta
    Berecová → prístup (Nelka Kysel a Beata sú trénerky/admin = automaticky).
  · ODKLADY v systéme: dôvod sa ukladá (coach_snooze_reason); počas odkladu
    banner „⏸ NA ODKLADE do X — dôvod" na karte klientky, po skončení červený
    „🔔 ODKLAD SKONČIL — treba kontaktovať" + lead vyskočí trénerovi hore
    (score 85, reason s dôvodom); odklad je udalosť v timeline (⏸).
  QA: qa/deal-link.test.js 36/0, lead-os 61/0, coach 83/0.
  Meranie: deal_links (vytvorené vs zaplatené %), konverzie cez link
  v coach_cases, objem línií v admin sekcii Ambasádori.

CHANGE-014d 2026-08-28  LEAD OS: timeline karty + medzikontakt + bez 1h brány
  · TIMELINE (Marek): každá klientka má na karte (detail → ❤️ Starostlivosť)
    JEDNU chronologickú históriu: kedy · kto · akcia · poznámka. Zdroje:
    registrácia, ľudské kontakty (tréner+admin), poznámky, odoslané maily
    (s otvorením/klikom), hodiny (✅/❌ no-show), platby, členstvá, follow-upy,
    case-y (prevzatie/uzavretie/KONVERZIA so zdôvodnením), DNC. Navrchu budúcnosť:
    najbližší automatický mail. GET /api/admin/crm/client/:id/timeline (250 max).
  · MEDZIKONTAKT (Beátka): „prevzala som, kontaktovala, nechcem uzavrieť case" —
    riadok Zapísať existoval, ale nebol zrozumiteľný. Teraz: popis „Zapíš výsledok
    dnešného kontaktu — case tým NEuzatváraš", zelený stav ✅ dnes kontaktovaná
    na karte, toast potvrdí, že lead ostáva jej.
  · KONVERZIA BEZ STOPIEK (Marek): podmienka „case ≥ 1 h" zrušená — ak zavolá
    a človek si hneď kúpi, konverzia platí. Ostáva: zapísaný kontakt + reálna
    návšteva/platba po prevzatí + povinné zdôvodnenie + cudzí sponzor nie.
  QA: lead-os.test.js 61/0, coach.test.js 83/0.

CHANGE-014c 2026-08-28  LEAD OS: konverzia len s povinným zdôvodnením
  Konverzia leadu (release s convert=true → tréner sa stáva sponzorom, affiliate)
  vyžaduje POVINNÚ poznámku (min. 20 znakov), AKO sa tréner o konverziu pričinil.
  Bez nej server vráti 400 need_note EŠTE PRED uzavretím case-u — lead ostáva
  prevzatý, tréner len doplní poznámku a skúsi znova (o konverziu nepríde).
  Zdôvodnenie sa ukladá: lead_notes s prefixom „🤝 KONVERZIA — ako sa pričinil/a",
  coach_cases.conversion_note a je aj v admin notifikácii o konverzii.
  UI: pri voľbe 5 (Konvertovaná) samostatný povinný prompt s príkladom.
  Existujúce antifraud podmienky (kontakt, ≥1 h case, reálna návšteva/platba,
  cudzí sponzor) bežia AŽ PO bráne poznámky — nezmenené.
  QA: lead-os.test.js 51/0, coach.test.js 83/0 (antifraud test posiela poznámku).

CHANGE-014b 2026-08-28  LEAD OS: týždenný report „Starostlivosť v číslach"
  GET /api/admin/care-report?days=N: kontakty (spolu/trend/záujem) + rozpad per
  člen tímu (tréner aj admin, outcome breakdown, follow-upy splnené, konverzie),
  duplicitné kontakty (2 rôzni ľudia < 3 dni, ručné — cieľ 0), hot pokrytie
  (registrácie → kontakt do 3 dní → s rezerváciou), follow-upy (nové/splnené/po
  termíne), zabudnuté + história pondelkových snapshotov (settings
  care_forgotten_hist, drží 12). UI: rozbaľovací blok v sekcii Leady.
  Pondelkový job (spoločný guard s watchdogom) posiela adminom notifikáciu
  type care_report so zhrnutím čísel. QA: lead-os.test.js 43/0.

CHANGE-014  2026-08-28  LEAD OS — jednotná zdieľaná vrstva starostlivosti
  Spec: docs/LEAD_OS_SPEC.md (Marekove zadanie: zdieľané info admin↔tréner,
  nikto nespamovaný, nikto nezabudnutý, dôležité oddelené s upozornením).
  · Admin píše kontakty do TEJ ISTEJ vrstvy ako tréneri (coach_contacts,
    by_role:'admin'): POST /api/admin/leads/:id/contact (+note, +followup do
    crm_tasks). Poznámky admina → lead_notes (users.notes je len zrkadlo).
  · Semafor: neodkladné úlohy skipujú KAŽDÝ typ pri ľudskom kontakte < 3 dni
    (lapsed 30 d) a karta nesie last_contact; coach 3-dňový filter vidí admin
    kontakty automaticky → nikto nevolá 2× v ten istý týždeň.
  · Neodkladné: tlačidlo „✓ + 📞 kontaktovaná" (dismiss + zdieľaný zápis naraz).
  · Detail klientky: tab ❤️ Starostlivosť (kontakty+poznámky+zápis), hlavička
    s posledným kontaktom a ďalším automatickým mailom; 🗂 tlačidlo v zozname.
  · Tréner v detaile leadu vidí automatiku: next_mail + active_sequences
    („🤖 Automatika pracuje: winback — ďalší mail …").
  · HOT: denná notifikácia (job 15 min, guard hot_leads_<d>) trénerom aj adminom
    o prio-1 úlohách; hot karty v Môj deň so 🔥 DÔLEŽITÉ DNES a červeným okrajom.
  · Watchdog: pondelok (guard lead_watchdog_<d>) — „zabudnuté" leady (použiteľný
    kontakt, >21 d bez dotyku, bez follow-upu/claimu/snooze/DNC) → notifikácia
    adminom; stats.forgotten + karta 🕸 Zabudnuté v sekcii Leady.
  QA: qa/lead-os.test.js 31/0 + regresie coach 82/0, puzzle 53/0, školy 62/0.
  Sandbox: celý tok preklikaný (urgent→modal→zmizne; leady; klient detail;
  tréner nedostane čerstvo kontaktovanú — cooldown potvrdený naživo).
  Meranie: coach_contacts (by_role) = duplicitné kontakty <3 d; stats.forgotten
  trend; konverzia hot úloh.

CHANGE-013b 2026-08-28  Venček: predvyplnený dopyt + denná automatika
  Landing (Netlify, programy/posledny-tanec.html): formulár #dopyt zjednodušený —
  povinná len škola + JEDEN kontakt (e-mail ALEBO telefón); motivačné riadky
  (nezáväzné stretnutie, 3 € škole, obmedzený počet škôl); tlačidlo „Máme záujem".
  Osobný odkaz: mail školy nesie &sid=<_id> → landing cez verejný
  GET /api/public/school-prefill/:sid (CORS) predvyplní názov školy, riaditeľa aj
  kontakt (dá sa prepísať) + plávajúce CTA „Máme záujem" k formuláru.
  Dopyt (/api/public/school-lead) so sid sa sám spáruje so školou v /admin/skoly:
  status replied, kontakt do poznámky — Marek vidí, komu volať.
  Automatika: 25 škôl/deň, 9.–17. h SK, len produkcia, denný settings guard;
  vypnutie school_outreach_autodrip=false. Zoznam škôl sa nasadzuje cez Railway
  env SCHOOLS_IMPORT_B64 (prod DB nie je prístupná zvonku), guard per obsah.
  Zdroj zoznamu: workflow — ZŠ s 9. ročníkom v okresoch Detva/Zvolen/Brezno,
  e-maily VÝHRADNE z oficiálnych zdrojov (web školy/register/zriaďovateľ),
  každý overený druhým agentom.
  QA: qa/school-outreach.test.js 62 kontrol (MAIL_CAPTURE=1).
  Meranie: open/klik per škola + dopyty (rentals school_lead so school_id) +
  stavy v mini-CRM; kanál = stretnutia / oslovené školy.

CHANGE-013  2026-08-28  Oslovenie škôl — Posledný tanec (venček)
  Nový akvizičný kanál mimo hlavného funnelu: cold e-mail riaditeľom ZŠ s cieľom
  dostať ich na sekciu „Pre školy" na fusionacademy.sk/programy/posledny-tanec.html
  (dopytový formulár + telefón). Modul school-outreach.js, admin /admin/skoly.
  Mail: osobný list (nie newsletter šablóna — deliverability aj dôveryhodnosť),
  fakty výlučne z overeného zoznamu venceky/PROMPTY-A-TEXTY.md, odhlásenie 1 klikom.
  UTM: utm_campaign=posledny-tanec-skoly, utm_content=<mesto>.
  Posiela sa po dávkach (priorita 8 v mail budžete), nikdy 2× tej istej škole;
  open/click z mail_logu (FUNNEL-012) sa priraďuje ku konkrétnej škole → mini-CRM
  so stavmi new/sent/replied/meeting/won/lost + poznámky po telefonátoch.
  QA: qa/school-outreach.test.js — 47 kontrol pod MAIL_CAPTURE=1 (žiadny reálny mail).
  Meranie: otvorenia a kliky per škola; stav won = dohodnutý venček. Kanál sa
  vyhodnotí ako počet stretnutí / počet oslovených škôl.
  ČAKÁ: zoznam škôl od Mareka (lepí sa do /admin/skoly), potom 1. dávka 20–30.

CHANGE-012  2026-08-27  Denný hlavolam — dva typy (cesta + osemsmerovka)
  Denná mini-hra za body do súťaže Klientka mesiaca. Modul puzzle.js (+ puzzle-words.js),
  stránka /hlavolam, karta na nástenke nad kolesom šťastia.
  Typy sa striedajú po dňoch (settings.puzzle_config.schedule = ['zip','words']),
  konkrétny deň sa dá prebiť cez overrides — admin vie na akciu nasadiť typ, ktorý chce.
    · zip — 6×6, spoj čísla 1..N v poradí a prejdi všetky políčka.
      Generátor: boustrofedón + backbite (pôvodný DFS na niektorých seedoch visel >120 s
      a bol synchrónny → blokoval by celý server). 120 dní za 31 ms.
    · words — osemsmerovka 11×11, 10 tanečných slov v 8 smeroch (aj odzadu), bez diakritiky.
  Hádanka je odvodená z DÁTUMU (seedovaný generátor) → pre všetkých rovnaká, časy sa dajú
  porovnávať. Riešenie overuje VÝHRADNE server; umiestnenie slov ani cesta sa neposielajú.
  Body: 1 + 1 za rýchlosť (<90 s), mesačný strop 40 — zámerne nízke, aby hlavolam
  neprebil hodinu (5 b). Najrýchlejší čas dňa berie +5 b, vyhodnocuje sa PO polnoci
  (job každých 20 min, guard settings.puzzle_winner_<date>, min. 2 hráčky).
  Anti-cheat: čas meria server (/api/puzzle/start ukladá do session, opakované otvorenie
  ho nenuluje); riešenie bez serverového štartu sa uzná, ale nemôže vyhrať deň (verified=false
  → mimo rebríčka). Klientske „seconds" sa ignoruje.
  Polnoc: hodiny bežia od OTVORENIA stránky, po polnoci sa stránka sama načíta znova
  a server odmietne riešenie starej hádanky (new_day) — rovnako ako koleso šťastia.
  Kto už má dnešok hotový, vidí pri návrate riešenie (solution / solution_path).
  OPRAVENÉ pri tejto zmene: cache hádaniek sa zahadzovala podľa abecedy kľúčov, čo vedelo
  vyhodiť práve vygenerovanú hádanku a vrátiť undefined (prejavilo sa až pri dvoch typoch).
  Teraz FIFO podľa poradia vzniku.
  Admin: GET/PUT /api/admin/puzzle (body, strop, bonus, schedule, overrides) + prehľad
  „čo pripadá na najbližších 7 dní".
  QA: qa/puzzle.test.js — 53 kontrol (oba typy, anti-cheat, serverový čas, rotácia typov,
  60 dní rôznych hádaniek, rýchlosť generovania, polnoc, cache).
  Meranie: puzzle_solves nesie date/seconds/points/fast/verified/type → denní hráči,
  podiel dokončení a či mini-hra dvíha návratnosť do appky (DAU medzi hodinami).

CHANGE-011  2026-08-25  CAC dashboard v2 (FUNNEL-014)
  /api/admin/cac-ltv rozšírené: payback_days (kumulatívna tržba kohorty vrátane vstupeniek
  v 30-dňových krokoch do 180 d vs spend); retention_d30/60/90 = % došlých, čo boli na hodine
  v okne [N-30, N] dní od akvizície (menovateľ len zrelé kontá, retention_base nesie n);
  offers per kampaň + totals_by_offer globálne (acquisition_offer paid_first_class → PAID,
  inak FREE — pole zapíše FUNNEL-015); rating_correlation: konverzia na platiacu/členku
  pre 4–5★ vs 1–3★ z hodnotení 1. hodiny (FUNNEL-010).
  Admin UI (loadCacLtv): stĺpce Payback + D30/D60/D90, FREE|PAID chip pri kampani,
  korelačný riadok 🌟 a blok 🧪 FREE vs PAID (zobrazí sa, keď existuje paid kohorta).
  QA: qa/funnel-014-cac-v2.test.js — deterministická kohorta s presnými dátumami,
  18 kontrol vrátane ručne overených čísel (payback 60 d, D30 100 %, D60/90 33.3 %).
  Meranie: payback ukáže, za koľko sa kampaň zaplatí; D30/60/90 kde padá návštevnosť;
  korelácia potvrdí, či hviezdičky predikujú nákup (ak áno — low rating = priorita hovoru).

CHANGE-010  2026-08-25  Dôvody rušenia členstva (FUNNEL-013)
  Klientske zrušenie Stripe odberu má namiesto confirm() modal: 6 dôvodov (čas/financie/
  zdravie/sťahovanie/nesadlo/iné) + voliteľná poznámka + tlačidlo „OSTÁVAM 💛"; dôvod je
  povinný. Server: whitelist kódov (neznámy → ine), zápis do db.feedback
  (type membership_cancel, plan, source stripe_self/paypal_self), okamžitá admin
  notifikácia 💔 s dôvodom a telefónom — šanca na záchranný hovor.
  GET /api/admin/churn-reasons?days=N — rozpad dôvodov + posledných 20 s poznámkami.
  QA hook: STRIPE_FAKE=1 (stripeApi bez siete). QA: qa/funnel-013-cancel-reasons.test.js
  (13 kontrol) + modal preklikaný v preview sandboxe.
  Meranie: rozpad dôvodov ukáže, či churn rieši produkt (termíny, hodiny) alebo život
  (sťahovanie, zdravie) — a kam mieriť retention akcie.

CHANGE-009  2026-08-25  Mail click-tracking + výkonnosť mailov (FUNNEL-012)
  sendMail prepíše každý odkaz v maile na /api/mail/click/<log_id>/<idx>; ciele sa ukladajú
  do mail_log.links a redirect ide podľa indexu — ŽIADNY open-redirect cez URL parameter.
  Klik zapíše clicked_at (prvý) + click_count a počíta aj ako otvorenie (pixely bývajú blokované).
  mail_log má nové pole template — otagovaných 14 mailov: first_booking_welcome (+.ics link,
  dopĺňa 011), booking_confirm, first_class_confirm(+_guest), class_reminder, first_booking_nudge,
  next_booking_nudge, abandoned_checkout, first_class_followup, membership_expiry, password_reset,
  event_campaign, admin_alert, sekvencie ako `<sequence>#d<day>`. Neotagované → bucket podľa subjectu.
  GET /api/admin/mail-performance?days=N: per šablóna sent/open%/click%/buyers/revenue,
  atribúcia LAST CLICK max 7 dní pred transakciou (1 nákup = 1 šablóna, žiadne dvojité počítanie).
  QA hook: MAIL_CAPTURE=1 (lokálne zaloguje+prepíše, nikdy neodošle — ako CAPI_DEBUG_FILE).
  QA: qa/funnel-012-mail-clicks.test.js (20 kontrol); regresie 004/006/008/011 zelené.
  Meranie: revenue per template ukáže, ktorý mail predáva; kliknutosť .ics linkov = meranie 011.

CHANGE-008  2026-08-25  „Pridať do kalendára" (.ics) v rezervačných mailoch (FUNNEL-011)
  GET /cal/booking/:id.ics — verejný .ics cez nespoznateľné booking _id (kapabilitný princíp
  ako manage_token; obsah bez osobných dát, zrušená rezervácia → 404). VEVENT s hodinou,
  časom (bez konca → +60 min), adresou (classes.address + mesto), VALARM -2 h.
  Link „📅 Pridať do kalendára" pridaný do 4 mailov: landing confirm (first-class/book),
  guest-invite confirm, in-app booking confirm (/api/bookings), day-before reminder.
  Landing stránka mala .ics už predtým (data-URI tlačidlo) — mailová cesta ho dopĺňa.
  QA: qa/funnel-011-ics.test.js (16 kontrol); regresie 001/002 zelené.
  Meranie: attendance rate (booking→attended %) — porovnať pred/po; kliknutosť linku
  bude merateľná po FUNNEL-012 (mail click-tracking).

CHANGE-007  2026-08-25  Hviezdičky po 1. hodine — feedback s low/high vetvením (FUNNEL-010)
  Karta #fbCard na client-dashboarde (nad stateStrip): „Ako ti sadla tvoja prvá hodina?" + 5 hviezd.
  Eligibilita: first_attended_at max 21 dní, nie import/dieťa/staff, 1× na osobu (kolekcia feedback).
  Vetvenie: 4–5★ → uloží hneď, poďakovanie + CTA POZRIEŤ ROZVRH; 1–3★ → textarea „Čo môžeme
  zlepšiť?" → admin notifikácia feedback_low + mail (p4) s kontaktom — osobná záchrana klientky.
  4–5★ = admin notifikácia feedback (🌟). manual-booking odteraz stampuje first_attended_at
  (predtým len creditAttendance). GET/POST /api/feedback/first-class,
  GET /api/admin/feedback/summary?days=N (responses, eligible_base, response_rate, avg, dist, latest).
  QA: qa/funnel-010-feedback.test.js (20 kontrol) + vizuálne overené v preview sandboxe.
  Meranie: response_rate zo summary; korelácia rating→konverzia príde v CAC dashboarde v2 (FUNNEL-014).

CHANGE-006  2026-08-25  Meta CAPI event_id dedup + plné eventy (FUNNEL-005)
  Dedup princíp: rovnaké event_id ide serveru (CAPI) aj Pixelu (fbq eventID) → Meta počíta 1×.
  fa-track.js: faEventId() per page-load; faGetAttribution() pridáva event_id; faTrack()
  posiela fbq eventID (CompleteRegistration automaticky, Purchase cez data.eventID).
  Kľúče: registrácia = page-load id; landing Lead/Schedule = lead_/sch_<id> (prva-hodina.html);
  Stripe membership Purchase = pur_<session_id> (server fulfil + return page pixel — dedupne aj
  webhook↔return double-fire CAPI); vstupenky IC = ic_<order>, Purchase = pur_<order>;
  FirstClassAttended = fca_<uid> (creditAttendance + manual-booking, idempotentné).
  metaCapi() rozšírené o {event_id, source_url} + CAPI_DEBUG_FILE (QA: payload do súboru, žiadna sieť).
  Nové CAPI eventy: Lead, Schedule, InitiateCheckout (membership + vstupenky), FirstClassAttended,
  Purchase pre vstupenky. QA: qa/funnel-005-capi.test.js (21 kontrol).
  Meranie: Meta Events Manager → Deduplication % pri CompleteRegistration/Lead/Purchase;
  kvalita optimalizácie kampaní na plnší signál (IC, FCA medzikroky).

CHANGE-005  2026-08-25  Mail priority budžet + abandoned checkout (FUNNEL-006 + 008)
  006: mailBudgetOk(priority) + stropy per priorita, kontrola priamo v sendMail(opts.priority)
       — žiadny flow ju nemôže obísť. Sekvencie=8 (marketingové)/4, remindery=3, expiry=4,
       konverzné nudge=5, event kampaň=10, transakčné (reset, výplatné pásky…)=2/default 4.
       processEmailQueue sa pri vyčerpaní budžetu zastaví a pokračuje na druhý deň.
  008: abandonedCheckoutTick — pending Stripe membership checkout 3–48 h → 1 mail (p6),
       revalidácia (paid after / aktívne členstvo → skip navždy), dedupe abandoned_mail_at.
       QA endpointy: /api/admin/qa/mail-budget?sent=N a /api/admin/qa/run-abandoned-checkout.
  Súbory: server.js, qa/funnel-006-008-mail.test.js (11 kontrol; regresie F001/2/4/7 všetky zelené).
  PREČO: Brevo 300/deň — potvrdenie rezervácie nesmie nikdy padnúť kvôli marketingu (spec AJ);
       nedokončený checkout je najlacnejší stratený nákup (spec Y).
  AKO MERIAME: mail_log „[mail budžet] preskočené" riadky; checkout→purchase recovery %.
  Stav: IMPLEMENTED + TESTED + DOCUMENTED.

CHANGE-004  2026-08-25  Customer state engine + personalizovaný home (FUNNEL-007)
  Pred: dashboard rovnaký pre všetky; klientka po prvej hodine nevidela ponuku ani countdown.
  Po:  GET /api/my-state — stav VŽDY odvodený zo source dát (bookings/memberships/promo_codes):
       REGISTERED_NO_BOOKING · FIRST_BOOKED · FIRST_NO_SHOW · FIRST_ATTENDED_NO_PURCHASE (so 48h
       kupónom a SERVEROVÝM countdownom) · NEW_CUSTOMER · ACTIVE · AT_RISK (členka 14+ dní bez hodiny
       bez rezervácie) · CHURNED. Dashboard „state strip" renderuje jeden dominantný CTA pre
       FIRST_BOOKED / FIRST_NO_SHOW / FIRST_ATTENDED_NO_PURCHASE / AT_RISK / CHURNED
       (REGISTERED_NO_BOOKING rieši hero z F001, NEW_CUSTOMER karta z F004 — bez duplicít).
  Súbory: server.js (/api/my-state), public/client-dashboard.html (stateStrip),
       qa/funnel-007-customer-state.test.js (8 kontrol; regresie F001 12/12, F004 11/11).
  PREČO: NEXT BEST ACTION je základ personalizácie celej appky (spec BD/BE).
  AKO MERIAME: state→next-step konverzie vo funnel dashboarde; CTR ponuky po 1. hodine.
  Stav: IMPLEMENTED + TESTED + DOCUMENTED.

CHANGE-003  2026-08-25  FUNNEL-003 + 004 + 009 (jeden balík)
  003: day-before reminder cielil VŠETKY rezervácie hodiny bez ohľadu na dátum (bug) → filter
       booking_date=zajtra + skip zrušených hodín a absolvovaných; nová in-app notifikácia
       „💃 Dnes tancuješ!" v deň hodiny (guard type+ref_id, bez mailu).
  004: /api/next-class/suggestions + karta na dashboarde so schváleným znením + mail
       „Členstvo máš aktívne 🎉 Kedy prídeš najbližšie?" 3–48 h po PRVOM platenom členstve,
       len ak nemá budúcu rezerváciu (revalidácia pred send, dedupe next_booking_nudge_at,
       mail budžet). QA endpoint /api/admin/qa/run-next-booking-nudge.
  009: trénerský zápis — badge „🌟 PRVÁ HODINA — privítaj ju" pri klientke s visit_count=0.
  Súbory: server.js, public/client-dashboard.html, public/trainer.html,
       qa/funnel-004-next-booking.test.js (11 kontrol; regresie F001 12/12, F002 16/16).
  PREČO: účasť (003), druhá návšteva (004) a zážitok prvýčky (009) sú tri najlacnejšie páky retencie.
  AKO MERIAME: booking→attendance a no-show % · first_purchase→second_booking · first→second attended.
  Stav: IMPLEMENTED + TESTED; MEASURED cez funnel dashboard; DOCUMENTED.

CHANGE-002  2026-08-25  Acquisition landing /prva-hodina (FUNNEL-002)
  Pred: reklamy viedli na homepage/registráciu — veľa CTA, žiadny mestský funnel.
  Po:  /prva-hodina?city=X — 1 ponuka, 1 CTA, mestské chips, najbližšie prezenčné termíny (kapacita,
       zrušené hodiny filtrované), rezervácia = meno+e-mail(+telefón) bez hesla: konto vznikne na pozadí
       (self_registration, registration_at actual, first-touch+UTM atribúcia, lead_source z fbclid/gclid/utm),
       free_class booking so všetkými guard-mi guest flowu (dedupe kontaktu, druhá „prvá zadarmo" 409,
       kapacita, zrušenia). Potvrdenie: MÁŠ TO 🎉 + čo si priniesť + PRIDAŤ DO KALENDÁRA (.ics) + mail
       s manage linkom. fbq Lead+Schedule client-side (CAPI dedup hotový — CHANGE-006).
  Súbory: server.js (GET /api/first-class/schedule, POST /api/first-class/book, route /prva-hodina),
       public/prva-hodina.html, qa/funnel-002-landing.test.js (16 kontrol, zelené).
  PREČO: acquisition reklama potrebuje landing bez rozhodovacieho šumu; UTM per mesto = čisté kohorty.
  AKO MERIAME: LP→booking % (kampane zumba_{city}_first_class v CAC dashboarde), registration→booking.
  Stav: IMPLEMENTED + TESTED (QA 16/16) + DOCUMENTED; MEASURED po spustení kampaní.

CHANGE-001  2026-08-25  Registrácia → prvá rezervácia (FUNNEL-001)
  Pred: po registrácii dashboard bez dominantného kroku; klientka bez rezervácie nedostala nič adresné.
  Po:  (1) dashboard hero „VYBER SI SVOJU PRVÚ HODINU" s najbližšími 4 termínmi (mesto klientky prvé),
       rezervácia na 1 klik; hero sa zobrazuje len stavu REGISTERED_NO_BOOKING a po rezervácii zmizne.
       (2) aktivačné maily +3 h a D2 s termínmi (firstBookingNudgeTick, každých 20 min; revalidácia stavu
       pred odoslaním, dedupe booking_nudge1/2_at, denný mail budžet, len self_registration — leadformy
       majú vlastnú sekvenciu). (3) QA endpoint /api/admin/qa/run-first-booking-nudge.
  Súbory: server.js (firstClassSuggestions, firstBookingEligible, firstBookingNudgeTick, 2 endpointy),
       public/client-dashboard.html (hero), qa/funnel-001-first-booking.test.js (12 kontrol, zelené).
  Polia: users.booking_nudge1_at, users.booking_nudge2_at.
  PREČO: najväčší drop-off funnelu (63 reg → 20 booking / 30 dní).
  AKO MERIAME: funnel dashboard registration→first_booking % + medián; mail_log subjekty nudge mailov.
  Stav: IMPLEMENTED + TESTED (QA 12/12), MEASURED cez funnel dashboard, DOCUMENTED.

CHANGE-000  2026-08-20..24  (pred založením MASTER dokumentu — retroaktívne)
  - Event modul (vstupenky, QR, affiliate, tržby v účtovníctve, UTM snapshot objednávok)
  - Klasifikácia kont + backfill v1/v2; CAC→LTV kohortový dashboard; spend_updated_at + STALE
  - attendance_status + no-show job + funnel dashboard (druhá konverzácia)
  - Kiosk: výber hodiny pri dvoch bežiacich + preferencia rezervácie
  - Reset hesla cez e-mail (token 60 min, session invalidácia)
  - Súkromné hodiny v bodoch/histórii/LTV; hotovosť trénerok; maily len z produkcie
  Stav: IMPLEMENTED + VERIFIED (podrobnosti v git logu)
```

*(nové zmeny zapisuj sem vo formáte CHANGE-NNN: dátum, oblasť, pred/po, súbory, polia, eventy, PREČO, AKO MERIAME, stav IMPLEMENTED/TESTED/MEASURED/DOCUMENTED)*
