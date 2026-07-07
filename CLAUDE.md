# Fusion Academy app

Webová appka tanečnej školy (Node.js + Express + NeDB, vanilla JS frontend, PayPal, Railway deploy z GitHub main).

**PRED KAŽDOU PRÁCOU si prečítaj `DEVELOPMENT_PLAN.md`** — obsahuje kompletný plán vývoja po fázach, konvencie kódu, známe pasce a checklist postupu. Pracuj podľa neho v poradí fáz; hotové fázy si odškrtni priamo v tom súbore (pridaj ✅ k nadpisu fázy).

Rýchle fakty:
- Lokálny beh: `node server.js` (port 3000), admin `admin@fusionacademy.sk` / `admin123`
- Po zmene servera: `node --check server.js`
- Po zmene frontendu: zvýš verziu cache v `public/sw.js`
- Kolekcia `db.memberships` obsahuje aj `_type:'body_analysis'` / `'fit_premena'` — filtruj `!m._type`
- Commit + push na `main` = automatický deploy na Railway
- Komunikuj s užívateľom po slovensky
