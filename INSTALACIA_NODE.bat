@echo off
title Fusion Academy – Instalacia Node.js
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo  ==========================================
echo   FUSION ACADEMY – Instalacia Node.js
echo  ==========================================
echo.

:: ── Krok 1: Skontroluj ci uz je nainstalovany ──────────────────
set "NODE_EXE="
for %%P in (
  "C:\Program Files\nodejs\node.exe"
  "C:\Program Files (x86)\nodejs\node.exe"
) do (
  if exist %%P set "NODE_EXE=%%~P"
)

:: Skus aj v PATH
where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  for /f "delims=" %%i in ('where node 2^>nul') do (
    if "!NODE_EXE!"=="" set "NODE_EXE=%%i"
  )
)

if defined NODE_EXE (
  echo  Node.js uz je nainstalovany:
  echo  %NODE_EXE%
  echo.
  "%NODE_EXE%" -v
  echo.
  echo  Mozete zatvorit toto okno a spustit SPUSTENIE.bat
  echo.
  pause
  exit /b 0
)

echo  Node.js nie je nainstalovany. Pokusam sa ho stiahnut...
echo.

:: ── Krok 2: Zistenie 32 alebo 64-bit systemu ──────────────────
set "ARCH=x64"
if "%PROCESSOR_ARCHITECTURE%"=="x86" (
  if "%PROCESSOR_ARCHITEW6432%"=="" set "ARCH=x86"
)
echo  Architektura systemu: %ARCH%

:: ── URL na Node.js LTS installer ──────────────────────────────
:: Node.js 20 LTS (Iron) – podporuje Windows 7 SP1 a novsi
if "%ARCH%"=="x64" (
  set "NODE_URL=https://nodejs.org/dist/v20.19.1/node-v20.19.1-x64.msi"
  set "NODE_FILE=%TEMP%\node_setup_x64.msi"
) else (
  set "NODE_URL=https://nodejs.org/dist/v20.19.1/node-v20.19.1-x86.msi"
  set "NODE_FILE=%TEMP%\node_setup_x86.msi"
)

echo  Verzia: Node.js 20 LTS
echo  Subor:  %NODE_FILE%
echo.

:: ── Krok 3: Skus winget (Windows 10/11) ───────────────────────
echo  [1/3] Pokusam sa pouzit winget (Windows 10/11)...
winget --version >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  if %ERRORLEVEL% EQU 0 (
    echo.
    echo  Instalacia cez winget uspesna!
    goto :restart_notice
  )
  echo  winget zlyhalo, skusam inu metodu...
  echo.
)

:: ── Krok 4: Skus PowerShell (Windows 7 SP1+) ──────────────────
echo  [2/3] Pokusam sa stiahnut cez PowerShell...
powershell -Command "& { $ErrorActionPreference='Stop'; try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('%NODE_URL%','%NODE_FILE%'); Write-Host 'Stiahnutie OK' } catch { Write-Host 'CHYBA:' $_.Exception.Message; exit 1 } }" 2>nul
if %ERRORLEVEL% EQU 0 (
  echo  Subor stiahnuty. Spustam instalator...
  echo  (Moze sa zobrazit okno Kontrola pouzivatelskeho uctu – kliknite Ano)
  echo.
  msiexec /i "%NODE_FILE%" /qb ADDLOCAL=ALL
  if %ERRORLEVEL% EQU 0 (
    echo.
    echo  Instalacia uspesna!
    del "%NODE_FILE%" >nul 2>&1
    goto :restart_notice
  )
  echo  Instalator zlyhal. Skusam dalsiu metodu...
  echo.
)

:: ── Krok 5: Skus bitsadmin (Windows Vista/7) ──────────────────
echo  [3/3] Pokusam sa stiahnut cez bitsadmin...
bitsadmin /transfer "NodeJS_Download" "%NODE_URL%" "%NODE_FILE%" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  if exist "%NODE_FILE%" (
    echo  Subor stiahnuty. Spustam instalator...
    msiexec /i "%NODE_FILE%" /qb ADDLOCAL=ALL
    if %ERRORLEVEL% EQU 0 (
      echo.
      echo  Instalacia uspesna!
      del "%NODE_FILE%" >nul 2>&1
      goto :restart_notice
    )
  )
)

:: ── Manualna fallback inštrukcia ────────────────────────────────
echo.
echo  ============================================================
echo   Automaticka instalacia zlyhala. Postupujte manualne:
echo  ============================================================
echo.
echo  1. Otvorte webovy prehliadac (Internet Explorer / Chrome)
echo.
echo  2. Prejdite na adresu:
echo        https://nodejs.org/dist/v20.19.1/
echo.
echo  3. Stiahnite subor:
if "%ARCH%"=="x64" (
  echo        node-v20.19.1-x64.msi
) else (
  echo        node-v20.19.1-x86.msi
)
echo.
echo  4. Spustite stiahnuty subor a nainstalovajte Node.js
echo.
echo  5. Po instalacii RESTARUJTE pocitac
echo.
echo  6. Spustite SPUSTENIE.bat
echo.
echo  ============================================================
echo.
pause
exit /b 1

:restart_notice
echo.
echo  ============================================================
echo   Node.js je nainstalovany!
echo  ============================================================
echo.
echo  DOLEZITE: Ak sa SPUSTENIE.bat neotvori, restarujte pocitac
echo  aby sa aplikovala nova PATH pre Node.js.
echo.
echo  Po restarte spustite SPUSTENIE.bat
echo.
pause
exit /b 0
