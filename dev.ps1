# Locus — one-click development launcher (PowerShell version)
# Starts Vite + Electron from the project root. No venv activation needed.
Set-Location "$PSScriptRoot\locus-frontend"

if (-not (Test-Path "node_modules")) {
    Write-Host "[locus] Installing frontend dependencies..."
    npm install
    if ($LASTEXITCODE -ne 0) { Write-Error "npm install failed"; exit 1 }
}

Write-Host "[locus] Starting Locus (Vite + Electron)..."
npm run electron:dev
