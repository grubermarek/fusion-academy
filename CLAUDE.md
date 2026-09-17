# Fusion Academy app

Webová appka tanečnej školy (Node.js + Express + NeDB, vanilla JS frontend, Stripe, Railway deploy cez `railway up`).

**PRED KAŽDOU PRÁCOU si prečítaj `DEVELOPMENT_PLAN.md`** — obsahuje kompletný plán vývoja po fázach, konvencie kódu, známe pasce a checklist postupu. Pracuj podľa neho v poradí fáz; hotové fázy si odškrtni priamo v tom súbore (pridaj ✅ k nadpisu fázy).

Rýchle fakty:
- Lokálny beh: `node server.js` (port 3000)
- Po zmene servera: `node --check server.js`
- Po zmene frontendu: zvýš verziu cache v `public/sw.js` (najprv si prečítaj aktuálnu — mení sa aj z iných konverzácií)
- Kolekcia `db.memberships` obsahuje aj `_type:'body_analysis'` / `'fit_premena'` — filtruj `!m._type`
- Nasadenie: commit + push na `main`, potom `railway up --detach` (GitHub trigger je nespoľahlivý)
- Repo je verejné — žiadne osobné dáta, tokeny ani kľúče do gitu
- Komunikuj s užívateľom po slovensky

## Konverzácie (od 17. 9. 2026)

Práca na appke je rozdelená do samostatných konverzácií v tomto priečinku, jedna na oblasť. Požiadavku z inej oblasti dokonči, ale upozorni, kam patrí ďalšia práca. Nikdy nepracuj v dvoch konverzáciách naraz na tej istej oblasti — `server.js` je jeden súbor a zmeny by sa prepísali.

| Konverzácia | Čo do nej patrí |
|---|---|
| Financie a faktúry | Stripe, platby, obnovy, faktúry, refundy, výplaty trénerov, sekcia Peniaze |
| Marketing a reklamy | Meta/Google Ads, meranie a CAPI, e-maily, storky, kampane |
| Hlavolamy a súťaže | denný hlavolam (kvíz, rytmus, slová), body, Klientka mesiaca, koleso, kamošky |
| Rozvrh, rezervácie a kiosk | hodiny, dochádzka, tréneri, technika, online hodiny, kiosk |
| Venčeky a školy | venčekové skupiny, rodičia, oslovenie škôl |
| Appka všeobecne | veci cez viac oblastí, audity, redizajn, nasadenie |

Web fusionacademy.sk je samostatný projekt (`C:\Fusion Academy\Web\fusion-academy`) — konverzácie k nemu otváraj tam. Automatizácie (storky, tip dňa, záloha DB) bežia ako naplánované úlohy mimo týchto konverzácií.
