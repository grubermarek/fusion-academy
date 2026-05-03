@echo off
title Fusion Academy MLM
cd /d "%~dp0"

echo.
echo  ==========================================
echo   FUSION ACADEMY MLM - Spustenie
echo  ==========================================
echo.

:: Hladaj Node.js - priame if exist (bez for smycky)
set "NODE_EXE="

if exist "C:\Program Files\nodejs\node.exe"      set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if exist "C:\Program Files (x86)\nodejs\node.exe" set "NODE_EXE=C:\Program Files (x86)\nodejs\node.exe"

:: Skus aj PATH
if "%NODE_EXE%"=="" (
  for /f "delims=" %%i in ('where node 2^>nul') do (
    if "%NODE_EXE%"=="" set "NODE_EXE=%%i"
  )
)

:: Nenasli sme node
if "%NODE_EXE%"=="" (
  echo  CHYBA: Node.js nie je nainstalovany!
  echo.
  echo  Spustite INSTALACIA_NODE.bat
  echo.
  pause
  exit /b 1
)

echo  Node.js najdeny: %NODE_EXE%
echo.
"%NODE_EXE%" -v

:: Hladaj npm vedla node.exe
set "NPM_CMD="
for %%D in ("%NODE_EXE%") do set "NODE_DIR=%%~dpD"
if exist "%NODE_DIR%npm.cmd" set "NPM_CMD=%NODE_DIR%npm.cmd"

:: Nainštaluj kniznice ak chybaju
if not exist "node_modules\express" (
  echo.
  echo  Prvy start - instalujem kniznice...
  echo.
  if "%NPM_CMD%"=="" (
    echo  CHYBA: npm nenajdeny.
    pause
    exit /b 1
  )
  "%NPM_CMD%" install
  if %ERRORLEVEL% NEQ 0 (
    echo  CHYBA pri instalacii knizniz.
    pause
    exit /b 1
  )
  echo  Kniznice OK.
)

echo.
echo  ==========================================
echo.
echo   E-shop:      http://localhost:3000/shop
echo   Dashboard:   http://localhost:3000
echo   Admin panel: http://localhost:3000/admin
echo.
echo   Admin email: admin@fusionacademy.sk
echo   Admin heslo: admin123
echo.
echo   Pre VYPNUTIE zatvorte toto okno.
echo.
echo  ==========================================
echo.

:: Otvor prehliadac po 3 sekundach (ping funguje na vsetkych Windows)
start "" cmd /c "ping -n 4 127.0.0.1 >nul && start http://localhost:3000"

:: Spusti server
"%NODE_EXE%" server.js

echo.
echo  Server zastaveny.
pause
