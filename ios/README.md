# iOS appka Fusion Academy

Nahrádza appku od Glofoxu v App Store — **rovnaké `bundle ID`**, takže klientkam
sa to aktualizuje samo a otvorí sa im naša appka.

| | |
|---|---|
| Apple ID appky | 6746727583 |
| bundle ID | `ie.zappy.latindancefusion` |
| vydavateľ | Latin Dance Fusion s.r.o (náš účet) |
| posledná glofoxová verzia | 8.4.4 (23. 6. 2025) |
| naša prvá verzia | **9.0.0** |

Vnútri obalu beží `https://app.fusionacademy.sk` — **čo nasadíme na Railway, je hneď
aj v appke**, bez schvaľovania Applom. Schvaľovanie treba len vtedy, keď sa mení
samotný obal (ikony, natívne funkcie, verzia).

## Čo appka vie natívne (kvôli Apple pravidlu 4.2)

Apple zamieta appky, ktoré sú „len web v obale". Preto obal pridáva:

- **upozornenia na telefón (APNs)** — zrušená hodina, pripomienka, potvrdenie rezervácie;
  posiela ich `push-ios.js` podľa oznámení v appke, odznak = počet neprečítaných
- **vibrovanie** pri potvrdení rezervácie a platby (`FA_NATIV.vibruj()`)
- **natívne zdieľanie** pozvánky pre kamošku (`FA_NATIV.zdielaj()`)
- **offline obrazovka** (`www/index.html`) namiesto bielej stránky bez signálu
- splash screen, tmavý stavový riadok, bezpečné okraje

Mostík je v `public/nativ.js` — v obyčajnom prehliadači sa neprejaví.

## Čo musí spraviť Marek (jednorazovo)

1. **APNs kľúč** — developer.apple.com → Certificates, Identifiers & Profiles → Keys →
   „+" → zaškrtnúť **Apple Push Notifications service (APNs)** → stiahnuť `.p8`
   (dá sa stiahnuť LEN raz) a poznačiť si **Key ID**; **Team ID** je vpravo hore v účte.
2. **Na Railway** pridať premenné:
   - `APNS_KEY_P8` = celý obsah `.p8` vrátane `-----BEGIN PRIVATE KEY-----`
   - `APNS_KEY_ID` = Key ID (10 znakov)
   - `APNS_TEAM_ID` = Team ID (10 znakov)
   - `APNS_PROD=1` (po zverejnení; pre TestFlight netreba — sandbox je default)
3. **App Store Connect** → Users and Access → **odobrať prístup Glofoxu**, nech už
   nevedia nahrať svoju verziu.
4. **App Store Connect API kľúč** pre cloudový build — viď tabuľku nižšie.

## Build v cloude (GitHub Actions) — netreba Mac

Workflow `.github/workflows/ios-testflight.yml` postaví appku na macOS runneri a pošle
ju rovno do TestFlightu. Spúšťa sa ručne: **GitHub → Actions → „iOS → TestFlight" →
Run workflow**, zadáš verziu a text pre testerov.

Raz treba pridať štyri tajomstvá v **Settings → Secrets and variables → Actions**:

| tajomstvo | kde ho vziať |
|---|---|
| `ASC_KEY_ID` | App Store Connect → Users and Access → **Integrations** → App Store Connect API → „+" → Key ID |
| `ASC_ISSUER_ID` | na tej istej stránke hore (Issuer ID, UUID) |
| `ASC_KEY_P8` | obsah stiahnutého `.p8` kľúča aj s riadkami BEGIN/END (sťahuje sa **len raz**) |
| `APPLE_TEAM_ID` | developer.apple.com → Membership details → Team ID |

Kľúč musí mať rolu **App Manager** alebo Admin, inak fastlane nevie vyrobiť certifikát.
Certifikát na distribúciu aj provisioning profil si workflow vypýta sám — nič sa nenosí ručne.
Číslo buildu = číslo behu workflowu, takže sa nikdy neopakuje.

> V App ID `ie.zappy.latindancefusion` musí byť zapnutá schopnosť **Push Notifications**
> (developer.apple.com → Identifiers). Glofoxová appka push posielala, takže tam zrejme už je;
> keby nie, zapneš ju jedným klikom.

Tento APNs kľúč (`.p8` pre push) a App Store Connect API kľúč sú **dva rôzne kľúče** —
prvý ide na Railway, druhý do GitHub secrets.

## Build na Macu (keď budeš chcieť ladiť)

```bash
cd ios
npm install
npx cap add ios          # vytvorí Xcode projekt (len prvýkrát)
npx cap sync ios
npx cap open ios         # Xcode
```

V Xcode:
- **Signing & Capabilities** → Team = Latin Dance Fusion s.r.o, zapnúť **Push Notifications**
  a **Background Modes → Remote notifications**
- ikony: `logo-mark.png` (1000×1000) → AppIcon set (Xcode si veľkosti dogeneruje)
- `Info.plist`: `NSCameraUsageDescription` = „Fotku do profilu si môžeš odfotiť priamo v appke."
- Version **9.0.0**, Build 1 → Product → Archive → Distribute → App Store Connect

Potom TestFlight (otestovať na svojom telefóne) → odoslať na schválenie.

## Čo napísať Applu pri odosielaní

- **Demo účet** (povinné, appka je za prihlásením): existujúci testovací účet z appky
  (🕵️), heslo napísať do „App Review Information".
- **Poznámka pre recenzenta:** „The app is the member app of a dance studio in Slovakia.
  Memberships and class passes are for in-person classes (physical services), payments
  are handled by Stripe in line with App Store Review Guideline 3.1.3(e)."
- **Čo s Online členstvom:** streamované hodiny sú digitálny obsah, na ktorý by Apple
  chcel vlastné platby (30 %). Kým to nevyriešime, v iOS appke sa plán **Online**
  nesmie dať kúpiť — treba ho skryť, keď `FA_NATIV.jeApp` je `true`.

## Čo zostáva dorobiť

- [ ] skryť Online plán v obale (viď vyššie)
- [ ] pridať hodinu do kalendára telefónu (natívna funkcia navyše)
- [ ] ikony a splash v Xcode asset katalógu
- [ ] screenshoty do App Store (6,7" a 6,5") a prepísať popis z glofoxového na náš
