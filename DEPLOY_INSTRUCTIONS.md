# Fusion Academy – Deployment Instructions

## Lokálne spustenie

```bash
cd app
npm install
node server.js
```
Server beží na http://localhost:3000

**Admin prístup:** admin@fusionacademy.sk / admin123

---

## Railway.app Deployment

### 1. Príprava
```bash
cd app
git init
git add .
git commit -m "Initial Fusion Academy deploy"
```

### 2. Railway CLI
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

### 3. ENV premenné (Railway Dashboard → Variables)

| Premenná | Hodnota | Popis |
|---|---|---|
| `PORT` | auto (Railway nastaví) | Port servera |
| `SESSION_SECRET` | váš-tajný-kľúč-min-32-znakov | Session kľúč |
| `PAYPAL_CLIENT_ID` | sandbox alebo live Client ID | Z developer.paypal.com |
| `PAYPAL_CLIENT_SECRET` | sandbox alebo live Secret | Z developer.paypal.com |
| `PAYPAL_ENV` | `sandbox` alebo `live` | Prostredie PayPal |

### 4. Testovanie PayPal Sandbox

1. Prihláste sa na [developer.paypal.com](https://developer.paypal.com)
2. Vytvorte **Sandbox Application** → získate Client ID + Secret
3. Nastavte `PAYPAL_ENV=sandbox`
4. Nastavte `PAYPAL_CLIENT_ID` a `PAYPAL_CLIENT_SECRET`
5. Sandbox testovacie karty: https://developer.paypal.com/tools/sandbox/

**Test platba:**
```bash
# 1. Vytvorte PayPal objednávku
curl -X POST https://vasadomena.railway.app/api/paypal/create-order \
  -H "Content-Type: application/json" \
  -d '{"amount": 50, "description": "Test Bronze"}'

# 2. Odpoveď obsahuje paypalOrderId
# 3. Otvorte PayPal approve URL a zaplaťte sandbox kartou
# 4. Capture-ujte platbu
curl -X POST https://vasadomena.railway.app/api/paypal/capture-order \
  -H "Content-Type: application/json" \
  -d '{"paypalOrderId": "PAYPAL_ORDER_ID_TU"}'
```

---

## Testovanie rezervácie

1. Otvorte http://localhost:3000/schedule
2. Kliknite na hodinu → modálne okno
3. Prihláste sa (alebo zaregistrujte cez API)
4. Kliknite "Rezervovať"
5. Overenie v adminovi: http://localhost:3000/admin → Rezervácie

**Test API:**
```bash
# Login
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"email":"admin@fusionacademy.sk","password":"admin123"}'

# Zoznam hodín
curl http://localhost:3000/api/classes -b cookies.txt

# Rezervácia (nahraďte CLASS_ID)
curl -X POST http://localhost:3000/api/bookings \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"class_id":"CLASS_ID","notes":"Test"}'
```

---

## Čo je hotové

### Backend (server.js)
- ✅ Auth (login/register/logout/session)
- ✅ E-shop (produkty, košík, objednávky)
- ✅ Rozvrh hodín (14 reálnych hodín)
- ✅ Rezervačný systém + čakací zoznam (waitlist)
- ✅ MLM Unilevel (8 rankov, 7-level provízie)
- ✅ Partner Dashboard (zárobky, downline, leaderboard)
- ✅ Admin Panel (partneri, objednávky, triedy, rezervácie)
- ✅ Komunita + Blog (Socket.io real-time, kanály, články)
- ✅ PayPal Orders API v2 (create-order, capture-order, webhook)
- ✅ Členský systém (Bronze/Silver/Gold/Online Basic/Online Premium)
- ✅ Online class access control (stream links pre platiacich)
- ✅ Rental module (dopyty o prenájom + admin správa)
- ✅ Kontaktný formulár
- ✅ Notifikácie (in-app pre platby, rezervácie, členstvo, waitlist)
- ✅ Blog admin CRUD (tvorba/editácia/mazanie článkov)
- ✅ 11 nových DB kolekcií (memberships, rentals, notifications, payments)

### Frontend (HTML stránky)
- ✅ index.html – Hlavná stránka s plnou navigáciou (14 odkazov)
- ✅ shop.html – E-shop s košíkom a checkout
- ✅ schedule.html – Rozvrh hodín s rezervačným modálom
- ✅ community.html – Real-time chat + blog kanál
- ✅ pricing.html – Kompletný cenník
- ✅ dashboard.html – Partner dashboard
- ✅ admin.html – Admin panel (+ Blog, Členstvá, Prenájmy, Platby)
- ✅ online.html – Online hodiny + členstvo
- ✅ contact.html – Kontaktný formulár
- ✅ rental.html – Formulár na prenájom priestoru
- ✅ programs.html – Prehľad 11 programov
- ✅ about.html – O nás (príbeh, tím, hodnoty)
- ✅ fitdays.html – FitDays workshop stránka
- ✅ blog.html – Blog s kategóriami a filtráciou
- ✅ meal-plan.html – BMR kalkulačka + 7-dňový jedálniček
- ✅ trainers.html – Trénerský tím
- ✅ cities.html – Mestá a prevádzky

### Deployment
- ✅ railway.json
- ✅ Procfile
- ✅ .gitignore

---

## Čo ešte ostáva dorobiť

- ✅ Body analysis module (meranie hmotnosti/tuku, história, grafy) → body-analysis.html
- ✅ Fit Premena tracking (weekly check-ins, transformačné metriky) → fit-premena.html
- ✅ Trainer dashboard (separátne rozhranie pre inštruktorov) → trainer.html
- ✅ Gallery page (fotogaléria) → gallery.html
- ✅ Podcast page → podcast.html
- ✅ Collaborate/Partnerstvo page → collaborate.html
- ✅ Email notifikácie (Nodemailer nainštalovaný, SMTP voliteľný cez ENV)
- ✅ Admin: Hodiny/Stream URL management → admin.html sekcia "Hodiny / Stream"
- ✅ Dashboard: Členstvo + notifikácie sekcie pridané
- 📋 PayPal frontend SDK (načítanie PayPal JS SDK pre checkout popup)
- 📋 SEO + meta tagy pre všetky stránky
- 📋 Railway custom domain: latindancefusion.art

## ENV premenné pre email (voliteľné)

| Premenná | Popis |
|---|---|
| `SMTP_HOST` | napr. smtp.gmail.com |
| `SMTP_PORT` | napr. 587 |
| `SMTP_USER` | email adresa |
| `SMTP_PASS` | heslo alebo app password |
| `SMTP_FROM` | "Fusion Academy" |
