# Fusion Academy — CRM audit & kompletný redesign komunikácie
**Dátum:** 5. 8. 2026 · **Rozsah:** všetky automatizácie v appke (e-maily, notifikácie, kupóny, crony, statusy) + návrh nového Customer Journey

---

## 1. ZISTENÉ PROBLÉMY (kompletný audit)

Systém má dnes **11 e-mailových sekvencií, ~25 blokov denného cronu, 4 typy kupónov, ~80 typov in-app notifikácií** a gamifikáciu (koleso, streaky, klientka mesiaca). Základ je prekvapivo silný — problémy boli hlavne v prekrývaní, dierach v guardoch a mŕtvom kóde.

### Kritické chyby (2) — ✅ OPRAVENÉ v tejto verzii
| # | Chyba | Dopad | Oprava |
|---|---|---|---|
| K1 | **Dvojitý winback enroll** — dva nezávislé bloky denného jobu zaraďovali odídené klientky do 13-mailovej winback série, každý s iným flagom. Druhý blok nemal denný limit ani filter kontaktov bez reálneho e-mailu. | Tá istá klientka mohla dostať 2-ročnú sériu dvakrát; pri prvom behu hrozilo hromadné odoslanie stoviek mailov naraz (spam blacklist). | Duplicitný blok zrušený; zaraďuje jediný blok s limitom 30/deň a 180-dňovým odstupom. |
| K2 | **Slabý dedup vo fronte** — guard proti duplicite kontroloval len „čakajúce" kroky. Po odoslaní prvého mailu sa dal človek zaradiť do tej istej sekvencie znova a celá sa mu poslala druhýkrát. | Duplicitné maily (v kóde bol dokonca cleanup duplicít gold_upsell — dôkaz, že sa to reálne dialo). | Guard rozšírený: krok sa nepošle, ak bol tomu istému človeku odoslaný za posledných 90 dní. |

### Vážne chyby (5) — ✅ OPRAVENÉ
| # | Chyba | Oprava |
|---|---|---|
| V1 | **Opt-out sa ignoroval pri odosielaní** — klientka s vypnutými ponukami ďalej dostávala marketingové sekvencie (winback až 720 dní!). GDPR + doručiteľnosť. | E-mailová fronta teraz preskakuje marketingové sekvencie pre každého s `offers_optout`. Servisné maily (expirácia, privítanie po kúpe) idú ďalej. |
| V2 | **membership_welcome sa nikdy nerušil** — po refunde/zrušení členstva prišiel mail „Ako ti ide prvý týždeň?". | Sekvencia sa ruší, ak členstvo už nie je aktívne. |
| V3 | **3 rôzne „chýbaš nám" maily naraz** — churn mail (deň 14), win-back kupón (deň 30) a winback séria (deň 30) sa prekrývali. | Winback séria štartuje s odstupom +2 dni od kupónu; poradie: deň 14 jemné pripomenutie → deň 30 kupón (1 hodina zdarma) → deň 32+ séria. |
| V4 | **Mŕtve sekvencie** `post_first_class` a `reengagement` — v admin UI vyzerali aktívne, ale nikdy sa nespúšťali (ich úlohu robia trial_followup a churn bloky). | Deaktivované + v admin UI označené „(VYPNUTÉ)" s vysvetlením. Duplicitná komunikácia nehrozí ani po omylnom zapnutí. |
| V5 | **Týždenný admin report bez guardu** — reštart servera v pondelok ráno ho poslal 2×. | Guard 1×/deň. |

### Menšie problémy — ✅ OPRAVENÉ
- PayPal plány uložené v kolekcii e-mailových krokov sa zobrazovali v admin UI ako „neznáma sekvencia" → odfiltrované.
- Admin UI malo popisy len pre 6 z 11 sekvencií → doplnené všetky (vrátane triggeru a stop podmienky).

### Známe riziká — ZATIAĽ NEOPRAVENÉ (odporúčania nižšie)
| # | Riziko | Návrh |
|---|---|---|
| R1 | Cron beží `setInterval` s podmienkou `hodina===8` — reštart o 8:05 znamená, že denné joby v ten deň nezbehnú. | Pridať catch-up: settings kľúč `daily_jobs_<dátum>`; ak o 9:00+ ešte nebeželi, spustiť. |
| R2 | Transakčné maily (faktúry, storno, výplatné pásky) nemajú dedup — retry endpointu = duplicitný mail. | Nízka priorita (spúšťa ich človek), ale pri refaktore pridať `mail_log` (viď bod 8). |
| R3 | Otvorenia/kliky mailov sa nemerajú — nevieme Open/Click Rate. | Viď bod 8 (logovanie) a 10 (KPI). |
| R4 | Kontakty `@import.local` (len telefón) nedostávajú nič — chýba SMS kanál. | sms-gate.app cez tvoj telefón (už rozdiskutované) — highest-impact quick win pre ~500 kontaktov. |

---

## 2. NOVÝ CUSTOMER JOURNEY (ideálny stav)

Fázy, ich cieľ, hlavná emócia a komunikácia. ✅ = už v systéme existuje, 🔧 = existuje ale treba doladiť, ➕ = nové, treba postaviť.

**NÁVŠTEVNÍK → REGISTRÁCIA**
Cieľ: znížiť trenie na nulu. Emócia: zvedavosť, bezpečie („nič neriskuješ").
✅ Google 1-klik registrácia, prvá hodina zdarma, UTM atribúcia. ➕ Exit-intent na webe: „Nechaj mail, pošleme ti rozvrh" (mini-lead).

**REGISTRÁCIA → PRVÁ REZERVÁCIA** (najdôležitejší skok — tu strácame najviac)
Emócia: odhodlanie + strach z neznáma. Psychológia: commitment (rezervácia = mikro-záväzok), social proof („2000+ tanečníčok"), scarcity (obsadenosť hodiny).
✅ welcome séria (deň 0/3/7), lead_nurture (3/7/14/30), eskalujúce zľavy pre leadov. 🔧 Do welcome mailu deň 0 pridať konkrétnu najbližšiu hodinu v JEJ meste (personalizácia z `city` — dáta už máme). ➕ Push notifikácia deň 2: „Vo štvrtok o 19:00 tancuje Brezno — ideš?"

**PRED PRVOU HODINOU**
Emócia: nervozita → istota. Peak-end rule začína už tu.
✅ Pripomienka deň vopred + ráno v deň hodiny (čo si obliecť, kde parkovať). 🔧 Pridať meno trénerky s fotkou („Bude ťa čakať Beáta") — zníženie sociálneho strachu.

**PO PRVEJ HODINE** (zlatá hodina predaja)
Emócia: endorfíny, hrdosť. Psychológia: reciprocity (dostala zadarmo), striking while hot.
✅ trial_followup (deň 2/5/9/16/25), tréner vidí „prvá hodina" badge a má ponúknuť členstvo na mieste. 🔧 Follow-up mail poslať **v ten istý večer** (teraz deň 2) — peak-end: „Dnes si spálila ~500 kcal. Takto vyzerá tvoj prvý krok." + ponuka prvého mesiaca. ➕ Foto/video z hodiny do feedu + mail (identity marketing: „som tanečnica").

**PO DRUHEJ HODINE → PREDAJ ČLENSTVA**
Psychológia: consistency (už prišla 2×, členstvo je logický ďalší krok), anchoring (10 € vstup vs. 39 € neobmedzene), loss aversion („bez členstva platíš za 4 hodiny viac").
✅ Trénerský predajný panel, promo kódy. ➕ Automatická kalkulačka v maile: „Bola si 3× tento mesiac = 30 €. S Bronze by si mala neobmedzene za 39 €."

**AKTÍVNY ČLEN**
Cieľ: habit formation (2+ hodiny/týždeň = retencia). Psychológia: streaky, variable rewards (koleso), progress effect (body, odznaky).
✅ Koleso šťastia + streak míľniky, body, odznaky, denné odmeny, súťaž o klientku mesiaca, referral výzva (taška/event/masterclass). 🔧 Bronze→Silver a Silver→Gold upsell série bežia — pridať trigger aj podľa správania (chodí 3×+ týždenne na Bronze = ideálna na upgrade).

**ČLENSTVO KONČÍ**
✅ expiry_warning (−7/−3/−1), obnova nadväzuje na koniec (dnes opravené!). ➕ Deň −7 pridať „obnov teraz a nič nestrácaš" (od dnešnej opravy je to pravda — komunikovať to!).

**NEAKTÍVNY (14/30 dní) → WIN-BACK**
✅ Deň 14 jemný mail → deň 30 kupón hodina zdarma → deň 32+ winback séria (13 mailov do 720 dní, stop pri návrate). Po dnešných opravách bez duplicít a s rešpektovaním opt-outu.

**VIP / AMBASÁDORKA**
✅ Klientka mesiaca (Gold + súkromná hodina + 20 % merch kupón + glow karta), klientka roka, referral kredity 10 %, referral výzva s odmenami. ➕ „VIP klub" status pre 50+ návštev: prednostné rezervácie na eventy, meno na stene štúdia (identity + status).

---

## 3.–4. SEGMENTY A KOMUNIKÁCIA PRE KAŽDÝ

| Segment | Definícia (dáta už máme) | Cieľ | Kanál + frekvencia | Kľúčová psychológia | Stop podmienka |
|---|---|---|---|---|---|
| Nový lead (web/ads) | `user_type:lead`, 0 návštev | prvá rezervácia | mail D0/3/7/14 + push D2 | zvedavosť, social proof | rezervácia/30 dní |
| Meta lead | `meta_lead:true` | prvá rezervácia | mail D0/3/7/14 (mesto!) | kontinuita s reklamou | návšteva |
| Importovaný (len tel.) | `@import.local` | prvá návšteva | **SMS** (chýba!) | reaktivácia vzťahu | claim účtu |
| Rezervovaná, ešte neprišla | booking confirmed, visits 0 | aby PRIŠLA | mail deň pred + ráno | istota, znižovanie bariér | attended |
| Po 1. hodine bez nákupu | `trial_followup_enrolled` | členstvo/permanentka | mail D0(večer!)/2/5/9/16/25 | reciprocity, peak-end | nákup |
| 2–4 návštevy bez členstva | visits 2–4, bez mem | členstvo | mail s kalkulačkou úspory | anchoring, consistency | nákup |
| Permanentkárka | `single_entries>0` | prechod na členstvo | mail pri 2 zostávajúcich vstupoch | loss aversion | členstvo |
| Bronze člen 14+ dní | plan bronze | upgrade Silver | bronze_upsell séria | progress, FOMO (online hodiny) | upgrade |
| Silver člen 14+ dní | plan silver | upgrade Gold | gold_upsell séria | status, identity | upgrade |
| Gold člen | plan gold | retencia + referral | mesačný „VIP digest" ➕ | exkluzivita, reciprocity | — |
| Členstvo končí ≤7 dní | expiry | obnova | mail −7/−3/−1 + push | loss aversion, kontinuita | obnova |
| Členstvo skončilo | včera expirovalo | okamžitá obnova | mail deň +1 (existuje) | „nič nestrácaš" (nadviazanie) | obnova |
| Neaktívna 14 dní | bez hodiny 14 d | návrat | 1 mail | starostlivosť, nie tlak | návšteva |
| Riziko odchodu 30 dní | bez hodiny 30 d | návrat | kupón zdarma + séria | reciprocity, urgency (24 h kupón) | návšteva/nákup |
| Stratená 90+ dní | winback séria dni 45–720 | posledná šanca | klesajúca frekvencia | novinky, zmena ponuky | návrat / opt-out |
| Veľmi aktívna (3+/týždeň) | attendance rate | referral + upsell | in-app výzvy | identity, gamifikácia | — |
| Klientka mesiaca | monthly_winners | ambasádorstvo | osobný mail + feed | status, recognition | — |
| Odporučila kamošku | referral count>0 | ďalšie odporúčania | referral výzva progress (dnes nové!) | goal gradient, variable rewards | 3/3 odmeny |
| Narodeniny/meniny | birthday | vzťah | notif + gratulácia komunity | osobný vzťah | — |
| Opt-out | `offers_optout` | rešpekt | LEN servisné maily | dôvera | — |

---

## 5. PREDAJNÁ PSYCHOLÓGIA — kde je a kde ju doplniť

Už zabudované: reciprocity (prvá zdarma, kupóny), commitment/consistency (rezervácie, streaky), social proof (feed, počet tanečníčok, rebríček), scarcity/urgency (24 h kupóny, kapacita hodín, waitlist), gamifikácia + variable rewards (koleso 1/2/5/10 b + vzácne výhry), progress effect (body, odznaky, referral progress bar — nový), identity (odznaky, tituly, ambasádorka), loss aversion (expiry maily), peak-end (glow karta víťazky).
Doplniť (viď prioritný zoznam): anchoring kalkulačka v upsell mailoch, goal-gradient v expiry komunikácii („už 6 mesiacov v kuse — nepreruš to"), curiosity gap v subjektoch winback mailov („Toto sa zmenilo, odkedy si tu nebola…").

## 6. KUPÓNY — stav a redizajn

| Kupón | Stav | Verdikt |
|---|---|---|
| VITAJSPAT (30 % členstvo, 1×/os., bez expirácie) | seed | 🔧 pridať expiráciu 14 dní od doručenia — bez deadline nemotivuje |
| PRVYMESIAC (−25 €, 1×/os., bez expirácie) | seed | 🔧 to isté; inak zdravý „first month" anchor |
| VITAZKA#### (20 % merch, 60 dní, viazaný na osobu) | auto každý mesiac | ✅ vzorový kupón |
| ZL20/ZL50 (členstvo, 24 h, viazaný na osobu) | auto pre leadov | ✅ výborná urgencia; sledovať redemption rate |
Zneužitie: kódy sú `once_per_user` + viazané na `target_user_id` → OK. ➕ Chýba: kupón k narodeninám (napr. −20 % na čokoľvek, 7 dní) a „nevyužitý kupón" pripomienka 24 h pred expiráciou (dáta máme, stačí denný blok).

## 7. NOVÉ KAMPANE NA DOPLNENIE (podľa dopadu)
1. **SMS kanál pre importované kontakty** (500+ ľudí bez e-mailu) — najväčší nevyťažený segment.
2. **Večerný follow-up po 1. hodine** (peak-end) namiesto D+2.
3. **Kalkulačka úspory** pre 2–4 návštevy bez členstva.
4. **Permanentka dochádza** (2 vstupy) → členstvo.
5. **Narodeninový kupón** + pripomienka nevyužitého kupónu.
6. **Waitlist follow-up**: „uvoľnilo sa miesto" už existuje — pridať „hodina sa plní, ostáva X miest" pre populárne hodiny (scarcity, dáta máme).
7. **Opustený checkout**: Stripe session vytvorená, nezaplatená → mail po 3 h (payments so status pending už evidujeme).
8. **Mesačný VIP digest pre Gold** — čo bolo, čo bude, jej štatistiky (retencia najvyššej hodnoty).

## 8. LOGOVANIE (návrh — zatiaľ neimplementované)
Jedna kolekcia `mail_log`: `{user_id, channel, template/step_id, sequence, trigger, sent_at, opened_at, clicked_at, converted_at, coupon_code, coupon_redeemed}`. Otvorenia: tracking pixel `GET /api/m/o/:id.png`; kliky: redirect `GET /api/m/c/:id?u=...`. Na karte klienta v admin CRM tab „História komunikácie" (chronologicky maily+notifikácie+kupóny). Konverzia = nákup do 7 dní od kliku.

## 9. PREVENCIA CHÝB — zavedené pravidlá
Každá automatizácia MUSÍ mať: (1) idempotentný guard (flag/settings kľúč/dedup vo fronte — po dnešku všade), (2) stop podmienku (konverzia/opt-out/návrat), (3) denný limit pri hromadných zaradeniach, (4) filter `@import.local` pre e-mailové kanály, (5) rešpekt `offers_optout` pre marketing. Nové pravidlo pre budúci kód: **jeden segment = jeden vlastník komunikácie** (nikdy dva bloky na ten istý trigger — presne to spôsobilo K1).

## 10. KPI (návrh dashboardu v admin → Marketing)
Na automatizáciu: Sent / Open % / Click % / Conversion % / Revenue. Globálne: Time-to-First-Visit (registrácia→1. hodina), Trial-to-Paid % (cieľ 25–40 %), Repeat Visit Rate (2. hodina do 14 dní), Membership Renewal % (cieľ 80 %+), Churn 30 d, Win-back % (návrat do 60 dní od kupónu), Referral Rate, Coupon Redemption % (ZL50 cieľ 10 %+), LTV = priem. mesiace členstva × priem. cena.

## 11. A/B TESTY (poradie podľa hodnoty)
1. Follow-up po 1. hodine: večer vs. D+2 (metrika: Trial-to-Paid, 100 klientok/variant).
2. Winback kupón: „1 hodina zdarma" vs. „−50 % prvý mesiac naspäť" (Win-back %).
3. Subject expiry −7: strata („O 7 dní prídeš o…") vs. kontinuita („Ďalší mesiac nadväzuje presne tam…").
4. Lead nurture D3: social proof vs. konkrétna hodina v jej meste.
Test končí pri ~100 doručeniach/variant alebo po 4 týždňoch; víťaz = vyššia konverzia, nie open rate.

## 12. PRIORITNÝ IMPLEMENTAČNÝ ZOZNAM
| P | Úloha | Dopad | Stav |
|---|---|---|---|
| 0 | Kritické+vážne opravy K1–K2, V1–V5 | ochrana doručiteľnosti a dôvery | ✅ HOTOVÉ dnes |
| 1 | SMS kanál (sms-gate.app) pre importované kontakty | 500+ nedotknutých kontaktov | čaká na inštaláciu appky v tvojom telefóne |
| 2 | Večerný follow-up po 1. hodine + trénerkino meno v pripomienke | najcitlivejší bod funnelu | ~1 h práce |
| 3 | mail_log + open/click tracking + história na karte klienta | bez merania neexistuje optimalizácia | ~pol dňa |
| 4 | Kalkulačka úspory + permanentka-dochádza kampaň | priamy predaj členstiev | ~2 h |
| 5 | KPI dashboard (bod 10) | rozhodovanie z dát | po bode 3 |
| 6 | Narodeninový kupón + pripomienka kupónu + opustený checkout | inkrementálne konverzie | ~2 h |
| 7 | Cron catch-up (R1) + VIP digest pre Gold | robustnosť + retencia | ~2 h |

---
*Vypracované na základe kompletnej inventarizácie kódu (server.js 13 100 riadkov, admin.html). Všetky opravy P0 sú nasadené vo verzii fa-v316 a pokryté E2E testami (65 checkov).*
