# QA regresné testy — Fusion Academy

Automatické testy, ktoré chránia appku pred návratom už opravených chýb.
Bežia proti **izolovanej lokálnej inštancii**, nikdy nie proti produkcii.

## Spustenie

```bash
# 1) izolovaná inštancia (vlastná DB, vypnutý rate limit)
cd "C:/Fusion Academy/MLM/app"
RATE_LIMIT_OFF=1 DATA_DIR=/tmp/fa-qa PORT=3991 node server.js

# 2) v druhom okne
node qa/security.test.js       # 39 kontrol: autorizácia, IDOR, escalation, validácie
node qa/data-integrity.test.js # 11 kontrol: kredity, členstvá, výplaty, dochádzka
```

Testovacie účty používajú doménu `@test-fa-qa.local` a prefix `QA_<timestamp>`,
takže sa dajú kedykoľvek jednoznačne identifikovať a odstrániť.

## Čo je pokryté (regresia opravených chýb)

| Test | Chráni pred |
|---|---|
| security: IDOR/escalation | prístup klienta k admin dátam a cudzím účtom |
| security: brute force | hádanie hesla (rate limiting) |
| security: validácie | neplatný e-mail, krátke heslo, prepísané polia |
| data T2/T3 | nesprávny odpočet a **neVrátenie vstupu pri zrušení** |
| data T6 | online hodina nesmie ísť do výplaty trénera |
| data T7 | dvojitá affiliate odmena trénerovi |
| data T10 | duplicitná dochádzka pri dvojitom kiosk skene |
