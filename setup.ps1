# setup.ps1 — Fortnite OBS Overlay setup for Windows (PowerShell)
# Run with: powershell -ExecutionPolicy Bypass -File setup.ps1

$ErrorActionPreference = "Stop"

function Ok   { param($msg) Write-Host "  [OK]  $msg" -ForegroundColor Green }
function Warn { param($msg) Write-Host "  [!]   $msg" -ForegroundColor Yellow }
function Fail { param($msg) Write-Host "  [FAIL] $msg" -ForegroundColor Red; exit 1 }
function Step { param($msg) Write-Host "`n$msg" -ForegroundColor White }

Write-Host ""
Write-Host "  +-----------------------------------------+" -ForegroundColor Cyan
Write-Host "  |    Fortnite OBS Overlay -- Setup         |" -ForegroundColor Cyan
Write-Host "  +-----------------------------------------+" -ForegroundColor Cyan
Write-Host ""

# ── 1. Check Node.js ──────────────────────────────────────────────────────────
Step "Checking dependencies..."

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Node.js not found. Install it from https://nodejs.org (v18 or later recommended)"
}

$nodeVersion = node --version
Ok "Node.js $nodeVersion found"

$nodeMajor = [int]($nodeVersion -replace 'v(\d+)\..*','$1')
if ($nodeMajor -lt 18) {
    Warn "Node.js v$nodeMajor detected. v18+ is recommended."
}

# ── 2. Detect runtime (Bun preferred, npm fallback) ───────────────────────────
$useBun = $false

if (Get-Command bun -ErrorAction SilentlyContinue) {
    $bunVersion = bun --version
    Ok "Bun $bunVersion found (will use Bun)"
    $useBun = $true
} else {
    Warn "Bun not found -- using npm instead."
    Warn "  Install Bun for faster startup: https://bun.sh/docs/installation"
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Fail "npm not found either. Please install Node.js from https://nodejs.org"
    }
    $npmVersion = npm --version
    Ok "npm $npmVersion found"
}

# ── 3. Install dependencies ───────────────────────────────────────────────────
Step "Installing dependencies..."

if ($useBun) {
    bun install
} else {
    npm install
}
Ok "Dependencies installed"

# ── 4. Set up .env ────────────────────────────────────────────────────────────
Step "Setting up environment..."

if (Test-Path ".env") {
    Ok ".env already exists -- skipping"
} else {
    Copy-Item ".env.example" ".env"
    Ok ".env created from .env.example"
}

# ── 5. Done ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:"
Write-Host "  1. Open " -NoNewline; Write-Host ".env" -ForegroundColor Cyan -NoNewline; Write-Host " and set your FORTNITE_API_KEY"
Write-Host "     Get one free at: https://fortnite-api.com"
Write-Host ""
if ($useBun) {
    Write-Host "  2. Start the server:  " -NoNewline; Write-Host "bun run dev:bun" -ForegroundColor Cyan
} else {
    Write-Host "  2. Start the server:  " -NoNewline; Write-Host "npm run dev" -ForegroundColor Cyan
}
Write-Host "  3. Open control panel: " -NoNewline; Write-Host "http://localhost:3000/control/" -ForegroundColor Cyan
Write-Host "  4. Add Browser Sources in OBS (see README.md)"
Write-Host ""
