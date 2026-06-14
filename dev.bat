@echo off
:: Locus — one-click development launcher
:: Starts the Vite dev server + Electron from the project root.
:: No venv activation or environment variable setup needed.

cd /d "%~dp0locus-frontend"

:: Check if node_modules exists; install deps if not
if not exist "node_modules" (
    echo [locus] Installing frontend dependencies...
    npm install
    if errorlevel 1 ( echo [locus] npm install failed & pause & exit /b 1 )
)

echo [locus] Starting Locus (Vite + Electron)...
npm run electron:dev
