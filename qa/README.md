# QA regresné testy — Fusion Academy

Automatické testy, ktoré chránia appku pred návratom už opravených chýb.
Bežia proti **izolovanej lokálnej inštancii**, nikdy nie proti produkcii.

## Spustenie

Väčšina testov si server spustí sama — izolovaná inštancia s vlastnou DB v tmp
priečinku (`DATA_DIR`), vypnutým rate limitom a `MAIL_CAPTURE=1` (nič neodíde
mailom). Účty a hodiny si zapíšu priamo do `.db` súborov a po sebe ich zmažú.

```bash
cd "C:/Fusion Academy/MLM/app"
node qa/data-integrity.test.js # kredity, členstvá, tržba, výplaty, dochádzka
node qa/family-freeday.test.js # víťazky, rodič bookuje dieťa, online deň zdarma
```

`security.test.js` sa zatiaľ pripája na ručne spustený server:

```bash
# 1) izolovaná inštancia (vlastná DB, vypnutý rate limit)
RATE_LIMIT_OFF=1 DATA_DIR=/tmp/fa-qa PORT=3991 node server.js
# maily sú mimo produkcie automaticky VYPNUTÉ (MAIL_ON=1 by ich zapol — nerob to)

# 2) v druhom okne
node qa/security.test.js       # 39 kontrol: autorizácia, IDOR, escalation, validácie
```

Testovacie účty proti ručne spustenému serveru používajú doménu `@test-fa-qa.local`,
takže sa dajú kedykoľvek jednoznačne identifikovať a odstrániť. Testy s vlastným
serverom zapisujú účty ako `@qa-biz.local` — migrácia `cleanup_qa_online_test_v1`
na čistej DB pri štarte všetky `@test-fa-qa.local` účty zmaže.

Pozor: registrácia vyžaduje celé meno bez číslic, bodiek a podčiarkovníkov
(`validFullName`) — „QA Free QAD_123" neprejde a test potom beží neprihlásený.

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
