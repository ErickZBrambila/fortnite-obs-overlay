#!/usr/bin/env bash
# setup.sh — Fortnite OBS Overlay setup for macOS / Linux
set -e

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

ok()   { echo -e "${GREEN}  [OK]${RESET} $1"; }
warn() { echo -e "${YELLOW}  [!]${RESET}  $1"; }
fail() { echo -e "${RED}  [FAIL]${RESET} $1"; exit 1; }
step() { echo -e "\n${BOLD}$1${RESET}"; }

echo -e "${BOLD}"
echo "  ┌─────────────────────────────────────────┐"
echo "  │      Fortnite OBS Overlay — Setup        │"
echo "  └─────────────────────────────────────────┘"
echo -e "${RESET}"

# ── 1. Check Node.js ──────────────────────────────────────────────────────────
step "Checking dependencies..."

if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version)
  ok "Node.js $NODE_VERSION found"
else
  fail "Node.js not found. Install it from https://nodejs.org (v18 or later recommended)"
fi

# Check Node version >= 18
NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  warn "Node.js v${NODE_MAJOR} detected. v18+ is recommended."
fi

# ── 2. Detect runtime (Bun preferred, npm fallback) ───────────────────────────
USE_BUN=false
if command -v bun &>/dev/null; then
  BUN_VERSION=$(bun --version)
  ok "Bun $BUN_VERSION found (will use Bun)"
  USE_BUN=true
else
  warn "Bun not found — using npm instead."
  warn "  Install Bun for faster startup: curl -fsSL https://bun.sh/install | bash"
  if ! command -v npm &>/dev/null; then
    fail "npm not found either. Please install Node.js from https://nodejs.org"
  fi
  ok "npm $(npm --version) found"
fi

# ── 3. Install dependencies ───────────────────────────────────────────────────
step "Installing dependencies..."

if [ "$USE_BUN" = true ]; then
  bun install
else
  npm install
fi
ok "Dependencies installed"

# ── 4. Set up .env ────────────────────────────────────────────────────────────
step "Setting up environment..."

if [ -f ".env" ]; then
  ok ".env already exists — skipping"
else
  cp .env.example .env
  ok ".env created from .env.example"
fi

# ── 5. Done ───────────────────────────────────────────────────────────────────
echo -e "\n${GREEN}${BOLD}Setup complete!${RESET}\n"
echo "  Next steps:"
echo "  1. Open ${BOLD}.env${RESET} and set your FORTNITE_API_KEY"
echo "     Get one free at: https://fortnite-api.com"
echo ""
if [ "$USE_BUN" = true ]; then
  echo "  2. Start the server:  ${BOLD}bun run dev:bun${RESET}"
else
  echo "  2. Start the server:  ${BOLD}npm run dev${RESET}"
fi
echo "  3. Open control panel: ${BOLD}http://localhost:3000/control/${RESET}"
echo "  4. Add Browser Sources in OBS (see README.md)"
echo ""
