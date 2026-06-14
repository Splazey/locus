@echo off
:: Locus — production launcher (builds Vite then opens Electron)
:: Use dev.bat during development (faster — no Vite build step).

cd /d "%~dp0locus-frontend"

if not exist "node_modules" (
    echo [locus] Installing frontend dependencies...
    npm install
    if errorlevel 1 ( echo [locus] npm install failed & pause & exit /b 1 )
)

echo [locus] Building Vite bundle...
call npm run build
if errorlevel 1 ( echo [locus] Vite build failed & pause & exit /b 1 )

echo [locus] Launching Locus...
npx electron .
