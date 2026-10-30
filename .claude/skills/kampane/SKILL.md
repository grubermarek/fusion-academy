---
name: kampane
description: Jednotné zakladanie, pomenovanie, značenie a meranie reklamných kampaní Fusion Academy (Meta, Google). Použi vždy, keď sa zakladá nová kampaň alebo reklama, mení sa bežiaca kampaň, vyhodnocuje sa výkon (ROAS, CPC, CPA, cena za registráciu), rieši sa UTM, pixel, dataset alebo karta kampane v appke, alebo keď sa má kampaň vypnúť či škálovať.
---

# Kampane Fusion Academy — jednotný postup

Cieľ: každá kampaň má rovnaký názov, rovnaké značky, rovnaké meranie a rovnaké pravidlá
vypínania. Vďaka tomu sa dajú kampane porovnávať medzi sebou a v admine je vždy prehľad.

**Nikdy nevymýšľaj čísla, ceny ani ponuky.** Ceny ber z `MEMBERSHIP_PLANS` v `server.js`,
rozvrh z `GET /api/first-class/schedule`, stav ponuky z `GET /api/landing/config`.

## 1. Pomenovanie

| Úroveň | Tvar | Príklad |
|---|---|---|
| Kampaň | `FA — <Téma> <MM/RRRR>` | `FA — Zumba Skúška 10/2026` |
| Ad set | `<Oblasť> — <publikum>` | `Stred Slovenska — ženy 25-55` |
| Reklama | `<Kód> — <uhol>` | `A — prvý týždeň zadarmo` |
| Kód kampane (utm) | `fa-<tema>-<MMRR>` | `fa-zumba-skuska-2610` |
| Kód kreatívy (utm_content) | `<pismeno>-<slug>` | `b-nemusis-vediet` |

Jedna téma = jedna kampaň. Nerob päť kampaní pre päť miest — mestá sú kreatívy alebo
ad sety vnútri jednej kampane, inak sa rozpočet rozdrobí pod hranicu učenia.

## 2. Značenie odkazu (povinné)

```
https://app.fusionacademy.sk/prva-hodina?utm_source=fb&utm_medium=cpc&utm_campaign=<kod-kampane>&utm_content=<kod-kreativy>&utm_term=<mesto|adset>
```

- `utm_campaign` je **vždy statické** — appka páruje kampaň podľa prefixu (`utm_key`).
  Dynamické makrá `{{campaign.id}}` párovanie rozbijú. `{{ad.id}}` smie ísť len do
  `utm_content`/`utm_term`.
- `utm_source`: `fb` | `ig` | `google`. `utm_medium`: `cpc` (platené) | `organic`.
- Odkaz patrí do poľa Website URL, nie do url_tags (strážca merania kontroluje oboje,
  ale v url_tags sa ľahko stratí pri úprave kreatívy).

## 3. Čo musí byť hotové, než kampaň pustíš

1. **Dataset a udalosti webu** — dataset `4085746221555327` (Fusion Academy App) zapnutý
   na úrovni reklamy. Bez toho Meta nevidí konverzie.
2. **Platný token** — `meta_ads_token` v settings; ten istý token posiela aj udalosti
   (náš dataset vlastný CAPI token mať nemôže). Stav je v Marketing → Meta: karta ukazuje,
   čo o tokene hovorí Meta, nie len to, že nejaký token tam je.
   Natrvalo to vyrieši **token systémového používateľa s platnosťou „Nikdy nevyprší"** —
   podmienkou je, aby reklamný účet `51759494` vlastnilo portfólio `latin.dance.fusion`
   (30. 10. 2026 ho nevlastnilo, účet je osobný). Dovtedy platí 60-dňový používateľský
   token, ktorý si appka obnovuje sama pri 30 dňoch — **ale len keď je uložený app secret**.
   Bez neho obnova ticho nerobí nič a token raz padne (13. 10. 2026 sme tak stratili štyri
   dni serverových udalostí).
3. **Karta kampane v appke** — Admin → Kampane, `utm_key` = prefix kódu kampane
   (napr. `fa-zumba-skuska*`) a `meta_campaign_id`. Bez karty kampaň **nevstúpi do metrík**
   (viď sekcia 5). Kartu zakladaj migráciou v `server.js` spolu s kampaňou.
4. **Strážca merania** — spusti v admine, musí hlásiť 0 nálezov.
5. **Prejdi tok na mobile** cez prehliadač Facebooku: reklama → landing → výber termínu →
   formulár → potvrdenie.

## 4. Nastavenie kampane (predvolené)

| Pole | Hodnota |
|---|---|
| Cieľ | Predaj (OUTCOME_SALES) |
| Optimalizácia | Konverzie → `CompleteRegistration` |
| Rozpočet | na úrovni kampane (CBO), stratégia Najvyšší objem |
| Atribúcia | 7 dní klik + 1 deň zobrazenie |
| Umiestnenia | Advantage+ |
| Záujmové cielenie | žiadne (publikum v našich mestách je malé) |
| Geografia | okruh okolo pobočky, nie celé Slovensko |
| Kreatívy naraz | najviac 3 |

Optimalizačnú udalosť vyberaj podľa objemu: potrebuje aspoň ~10 konverzií týždenne.
Objem overíš cez `ads_get_dataset_stats` (28 dní). Keď `Purchase` objem nemá, ide sa na
`CompleteRegistration`; na kliky sa neoptimalizuje nikdy — tým sa minulo 797 € bez výsledku.

## 5. Meranie — čo sa ráta a čo nie

Appka delí kampane podľa kvality merania (`kvalitaMerania()` v `server.js`):

| Stupeň | Podmienka | Vstupuje do metrík? |
|---|---|---|
| `plne` | utm + karta v appke + prvá útrata po `MERANIE_OD` (2026-09) | áno |
| `ciastocne` | chýba utm alebo karta, alebo časť peňazí padla skôr | nie (v zozname zostáva) |
| `ziadne` | ani utm, ani karta | nie (mimo zoznamu, pod filtrom 📦 Nemerané) |

**Do klikov, CPC, CTR, CPM, CPL a ROAS vstupujú len kampane so stupňom `plne`.**
Útrata sa nestráca nikdy — `totals.spend` obsahuje všetko, aby čísla sedeli s účtovníctvom.
ROAS sa počíta z tržby ľudí, ktorí z reklamy prišli (kohorta), nie z tržby celej appky.

Test: `node qa/meranie-kvalita.test.js`.

Kde sa čítajú čísla:
- Admin → Marketing → Kampane: `GET /api/admin/ads/overview`
- Lievik stránky: `GET /api/admin/funnel-stranky` (`lp_view → lp_termin → form_submit → trial_ok`)
- Návratnosť kohorty: `GET /api/admin/cac-ltv`

## 6. Pravidlá vyhodnocovania

Prvých 7 dní nemeň nič (učiaca fáza). Potom:

| Kedy | Čo sledovať | Rozhodnutie |
|---|---|---|
| Deň 3 | návštevy v appke vs. kliky v Mete | pri nule najprv over meranie a odkaz, nie kreatívu |
| Deň 7 | cena za registráciu | nad cieľom vymeň najviac jednu kreatívu |
| Deň 14 | cena za prvú účasť | nad dvojnásobkom cieľa kampaň zastav a oprav ponuku |
| Priebežne | frekvencia > 2,5 za 7 dní | publikum je vyčerpané, obmeň kreatívu |

Cieľové ceny počítaj z rozpočtu a cieľa (rozpočet ÷ počet), nie z pocitu. Stopky:
reklama bez registrácie po ~2,5-násobku cieľovej ceny, celá kampaň po ~6-násobku.

CTR a CPC nie sú kritérium úspechu — pri našich doterajších kampaniach boli výborné
(CTR 7 %, CPC 0,03 €) a priniesli 4 registrácie za 797 €.

## 7. Po skončení kampane

1. Zapíš výsledok do `docs/KAMPAN_<TEMA>_<RRRR-MM>.md` (dokumenty kampaní sú v `.gitignore`).
2. Kartu v appke nechaj — drží históriu tržieb kohorty.
3. Kampaň v Mete nemaž, len vypni; zmazaná kampaň zmizne z prehľadu aj s útratou.
