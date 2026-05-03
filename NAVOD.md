# Fusion Academy – Deployment & Návod

## 🚀 Nasadenie na Railway (odporúčané)

### Predpoklady
- Účet na [GitHub](https://github.com) (zadarmo)
- Účet na [Railway](https://railway.app) (zadarmo, 5 USD credit/mesiac)
- Nainštalovaný [Git](https://git-scm.com)

---

### Krok 1 – Inicializujte Git repozitár

Otvorte terminál v priečinku `app/` a spustite:

```bash
git init
git add .
git commit -m "Initial deploy – Fusion Academy v2.0"
```

### Krok 2 – Nahrajte na GitHub

1. Choďte na https://github.com/new
2. Vytvorte repozitár `fusion-academy` (Private odporúčané)
3. Skopírujte URL repozitára (napr. `https://github.com/VAS_NICK/fusion-academy.git`)
4. Spustite:

```bash
git remote add origin https://github.com/VAS_NICK/fusion-academy.git
git branch -M main
git push -u origin main
```

### Krok 3 – Vytvorte projekt na Railway

1. Choďte na https://railway.app a prihláste sa
2. Kliknite **New Project → Deploy from GitHub repo**
3. Vyberte repozitár `fusion-academy`
4. Railway automaticky detekuje Node.js a spustí `npm start`

### Krok 4 – Nastavte environment premenné

V Railway dashboarde → váš projekt → **Variables** → pridajte:

| Premenná | Hodnota | Popis |
|----------|---------|-------|
| `SESSION_SECRET` | (dlhý náhodný reťazec, min. 32 znakov) | Šifrovanie sessions |
| `NODE_ENV` | `production` | Aktivuje HTTPS cookies |
| `PAYPAL_CLIENT_ID` | (váš PayPal live Client ID) | PayPal platby |
| `PAYPAL_SECRET` | (váš PayPal live Secret) | PayPal server-side |
| `PAYPAL_ENV` | `live` | alebo `sandbox` na testovanie |
| `EMAIL_USER` | (váš Gmail alebo SMTP email) | Notifikácie emailom |
| `EMAIL_PASS` | (app password z Google účtu) | SMTP autentifikácia |
| `ADMIN_EMAIL` | `admin@fusionacademy.sk` | Kam chodia kontaktné formuláre |

**SESSION_SECRET** – vygenerujte napr. na: https://generate-secret.vercel.app/64

### Krok 5 – Nastavte vlastnú doménu

1. Railway → váš projekt → **Settings → Domains**
2. Kliknite **Add Custom Domain**
3. Zadajte `latindancefusion.art`
4. U vášho registrátora domény nastavte CNAME záznam:
   - Meno: `@` alebo `www`
   - Hodnota: Railway vám ukáže (napr. `xxx.up.railway.app`)
5. Počkajte 5–60 minút kým sa DNS propaguje

---

## 🔐 Prvé prihlásenie

Po nasadení choďte na `https://latindancefusion.art` a prihláste sa ako admin:

- **Email:** `admin@fusionacademy.sk`
- **Heslo:** `admin123`

**⚠️ Okamžite zmeňte heslo po prvom prihlásení!**

---

## 📦 Štruktúra projektu

```
app/
├── server.js          # Express backend (~1670 riadkov)
├── package.json       # Závislosti + engines
├── railway.json       # Railway konfigurácia
├── Procfile           # web: npm start
├── .gitignore         # vylučuje node_modules, data/*.db, .env
├── data/              # NeDB databázy (vytvárajú sa automaticky)
│   └── .gitkeep
└── public/            # Frontend (24 HTML stránok)
    ├── index.html
    ├── programs.html
    ├── schedule.html
    ├── pricing.html
    ├── online.html
    ├── dashboard.html
    ├── admin.html
    ├── trainer.html
    └── ... (16 ďalších)
```

---

## 🗃️ Zálohovanie databázy

Databázy sú uložené v priečinku `data/` ako `.db` súbory (jeden súbor = jedna kolekcia):
- `users.db`, `bookings.db`, `memberships.db`, `orders.db`, `payments.db`, `transactions.db`, `commissions.db`, `notifications.db`, `messages.db`, `products.db`, `classes.db`, `rentals.db`

**Na Railway:** Dáta sa stratia pri redeploy! Pre produkciu nastavte Railway Volume:
- Railway → váš projekt → **Volumes** → pridajte volume na cestu `/app/data`

---

## 💳 PayPal nastavenie

1. Choďte na https://developer.paypal.com
2. Vytvorte App v časti **My Apps & Credentials**
3. Skopírujte **Client ID** a **Secret**
4. Pre testovanie použite `sandbox` credentials + `PAYPAL_ENV=sandbox`
5. Pre ostré platby prepnite na `live` credentials

---

## 📧 Email (nodemailer) nastavenie

Gmail:
1. Zapnite 2FA na Google účte
2. Choďte na: https://myaccount.google.com/apppasswords
3. Vygenerujte App Password pre "Mail"
4. Nastavte `EMAIL_USER=vas@gmail.com` a `EMAIL_PASS=vygenerovane-heslo`

---

## 🔧 Lokálny vývoj

```bash
# Nainštalujte závislosti
npm install

# Spustite vývojový server (bez NODE_ENV=production)
npm run dev

# Otvorte prehliadač na
http://localhost:3000
```

---

## 📋 Provízny systém (MLM Unilevel)

```
Predaj 50€ (Bronze členstvo)

→ Predajca (L0):   50€ × 20% = 10,00€
→ Sponzor L1:      50€ × 10% = 5,00€
→ L2:              50€ × 6%  = 3,00€
→ L3:              50€ × 4%  = 2,00€
→ L4:              50€ × 3%  = 1,50€
→ L5:              50€ × 2%  = 1,00€
→ L6:              50€ × 1%  = 0,50€
→ L7:              50€ × 1%  = 0,50€
```

**Podmienka výplaty downline:** min. 100€ osobného obratu za posledných 30 dní.

## 🏆 Ranky

| Rank | Osobný obrat | Tímový obrat |
|------|-------------|-------------|
| Starter | 0€ | 0€ |
| Partner | 300€ | 500€ |
| Senior Partner | 500€ | 1 500€ |
| Leader | 750€ | 5 000€ |
| Team Leader | 1 000€ | 15 000€ |
| Regional Leader | 1 000€ | 40 000€ |
| Director | 1 500€ | 100 000€ |
| Elite Director | 1 500€ | 250 000€ |

---

*Fusion Academy v2.0 · Máj 2026 · latindancefusion.art*
