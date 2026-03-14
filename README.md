# Fortnite OBS Overlay

Real-time Fortnite stats overlay for OBS Studio. Combines three data sources for the most accurate live stats available without modding the game:

| Source | What it provides |
|---|---|
| [fortnite-api.com](https://fortnite-api.com) | Historical K/D, win rate, session deltas |
| `FortniteGame.log` | Match start/end, local player kills (estimated), deaths, party, playlist |
| Overwolf GEP *(optional)* | Accurate kill count, squad alive/knocked state, real placement |

---

## Overlays

| Overlay | URL | OBS Size | Description |
|---|---|---|---|
| Live | `/live/` | 260 × 160 | Compact session tracker — K/D, kills, deaths, session timer |
| Overview | `/overview/` | 420 × 380 | Full stats dashboard with all-time stats and mode breakdown |
| Squad | `/squad/` | dynamic | Per-player cards for up to 4 squad members |
| Control Panel | `/control/` | *(browser tab)* | Configure players, themes, squad, log path |

---

## Getting a Fortnite API Key

1. Go to [fortnite-api.com](https://fortnite-api.com)
2. Click **Get API Key** — sign in with Discord (free)
3. Copy the key from your dashboard

---

## Setup

### Quick setup (recommended)

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1
```

**macOS / Linux:**
```bash
chmod +x setup.sh && ./setup.sh
```

> If PowerShell blocks the script: `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` (one-time).

---

### Manual setup

#### Prerequisites

- [Node.js](https://nodejs.org) v18+
- [Bun](https://bun.sh) *(optional, faster startup)*

#### 1. Install dependencies

```bash
npm install
# or: bun install
```

#### 2. Configure `.env`

```bash
cp .env.example .env   # macOS/Linux
copy .env.example .env # Windows
```

Edit `.env`:

```env
FORTNITE_API_KEY=your_key_here
DEFAULT_USERNAME=YourEpicUsername
PORT=3000
POLL_INTERVAL_MS=30000

# Log polling (see section below)
FORTNITE_LOG_PATH=C:\Users\YourName\AppData\Local\FortniteGame\Saved\Logs\FortniteGame.log
```

#### 3. Start the server

```bash
npm run dev      # hot-reload with ts-node-dev
# or
bun run dev:bun  # faster with Bun
```

The terminal will print all overlay URLs on startup.

---

## Adding Overlays to OBS

1. **Add Source → Browser Source**
2. Enter the URL from the table above
3. Set the width/height
4. Check **Refresh browser when scene becomes active**

> The Squad overlay width is dynamic — it adjusts to the number of players (210px per card). Start with 840px for 4 players.

---

## Squad Overlay Setup

The squad overlay shows live per-player stats for up to 4 teammates.

### Step 1 — Add your squad in the Control Panel

1. Open `http://localhost:3000/control/` in your browser
2. Go to the **Squad** section
3. Add each teammate's Epic username and select their platform (PC / PS5 / Xbox / Switch)
4. Click **Save Squad**

The overlay updates immediately. Each player card shows:
- Kill count (session, from API)
- K/D ratio
- Deaths
- Matches / Wins / Win%
- **LIVE** badge when real-time log or GEP data is active
- Status dot: green = alive, orange pulsing = downed, red = eliminated

### Step 2 — Enable log parsing for your own player

In `.env`, set `FORTNITE_LOG_PATH` to your Fortnite log file:

```env
# Windows — replace YourName with your Windows username (run: echo %USERNAME%)
FORTNITE_LOG_PATH=C:\Users\YourName\AppData\Local\FortniteGame\Saved\Logs\FortniteGame.log
```

This gives you real-time match start/end, kill estimates, and death detection for **your own player card** while in a match. Teammates still pull from the API.

### Step 3 — Install the Overwolf bridge *(optional but recommended)*

The Overwolf bridge unlocks accurate real-time data for the whole squad — see the section below.

---

## Log Polling

Log polling watches `FortniteGame.log` every 500ms and detects events without waiting for the API.

### What it detects (Fortnite Chapter 6 confirmed patterns)

| Event | Detail |
|---|---|
| Match start | Playlist / game mode detected |
| Match end | When you leave the map |
| Your kills | Best-effort estimate via kill score increments — not player-attributed |
| Your death | Detected from spectate-after-death log line |
| Party members | Teammates who join your party |
| Playlist change | Zero Build, Build, Reload, Creative |

> **Why "estimated" kills?** Modern Fortnite logs only write `KillScore = N` (a running total across all ~70 players interleaved, with no player names). The server tracks your score by looking for monotonically incrementing sequences. It's roughly right but not perfect — Overwolf GEP gives exact counts.

### Log file location

| Platform | Path |
|---|---|
| Windows | `C:\Users\YourName\AppData\Local\FortniteGame\Saved\Logs\FortniteGame.log` |
| macOS (CrossOver) | `/Users/YourName/Library/Application Support/CrossOver/Bottles/Fortnite/drive_c/users/YourName/AppData/Local/FortniteGame/Saved/Logs/FortniteGame.log` |

The folder may be hidden on Windows. Enable **View → Hidden items** in File Explorer.

---

## Overwolf Bridge (Real-time GEP)

The Overwolf bridge is a minimal background app (~100 lines) that taps Overwolf's Game Events Provider API and forwards real-time Fortnite events to the overlay server over a local HTTP connection.

### What GEP adds over log parsing

| Data | Log parsing | GEP |
|---|---|---|
| Kill count (local player) | Estimated | Exact |
| Local player downed | No | Yes |
| Local player eliminated | Yes | Yes |
| Local player revived | No | Yes |
| Final placement | No | Yes (shown in overlay footer for 15s) |
| **Squad member alive/knocked** | **No** | **Yes — live dot per card** |
| Match start/end | Yes | Yes |

### Install

#### 1. Install Overwolf

Download from [overwolf.com](https://www.overwolf.com). It must be running when you play.

#### 2. Load the bridge as a dev app

1. Open the Overwolf client
2. Click your profile icon → **Settings**
3. Go to **About** → **Development options**
4. Click **Load unpacked extension**
5. Navigate to and select the `overwolf-bridge/` folder in this project
6. Click **Select Folder**

The bridge app will appear in your Overwolf dock as **"Fortnite OBS Bridge"**.

#### 3. That's it

The bridge auto-launches when Fortnite starts (configured in `manifest.json`). It connects to `http://localhost:3000/api/gep-event` and begins forwarding events. No configuration needed.

> **Port mismatch?** If you changed `PORT` in `.env` from the default `3000`, edit the `SERVER_URL` constant at the top of `overwolf-bridge/background.js` to match.

### How it works

```
Fortnite
  ↓  Overwolf reads game telemetry
Overwolf client
  ↓  GEP JavaScript API (runs inside Overwolf's Chromium)
overwolf-bridge/background.js
  ↓  POST http://localhost:3000/api/gep-event
src/server.ts  →  WebSocket broadcast
  ↓
OBS overlay (squad cards update live)
```

The bridge app has no UI and no Overwolf store involvement. It runs entirely in the background.

---

## Themes

Set via the control panel or by editing `data-theme` on `<body>` in any overlay HTML:

| Theme | Description |
|---|---|
| `fortnite` | Default — Fortnite native blue |
| `minimal` | Clean dark monochrome |
| `neon` | Purple/cyan neon |
| `dark` | Near-black, no color |
| `gold` | Victory Royale gold |
| `purple` | Royal purple |
| `glass` | Frosted glass, semi-transparent |
| `liquid` | iOS 26 Liquid Glass — heavy blur, specular highlights, deep shadow |

To add a custom theme, add a `[data-theme="yourtheme"]` block to `overlay/shared/theme.css` and override the CSS custom properties.

---

## Session Tracking

Session stats are the **delta from when tracking started**. The baseline is set on first API poll per player and is in-memory (resets if you restart the server).

- Use **Reset Session** in the control panel to zero out mid-stream
- Squad stats reset automatically when a new match starts (log or GEP event)

---

## Configuration Reference

### `.env` options

```env
FORTNITE_API_KEY=        # Required — your fortnite-api.com key
DEFAULT_USERNAME=        # Optional — auto-load this player on startup
PORT=3000                # Server port
POLL_INTERVAL_MS=30000   # API poll interval in ms (min 10000)
FORTNITE_LOG_PATH=       # Optional — full path to FortniteGame.log
```

### REST API

| Method | Endpoint | Body | Description |
|---|---|---|---|
| POST | `/api/player` | `{ "username": "..." }` | Set active player |
| POST | `/api/session/reset` | — | Reset session baseline |
| GET | `/api/status` | — | Server status |
| GET | `/api/config` | — | Current config |
| POST | `/api/config` | `{ apiKey, pollIntervalMs, ... }` | Update config |
| GET | `/api/squad` | — | Current squad players |
| POST | `/api/squad` | `{ "players": [...] }` | Set squad (max 4) |
| POST | `/api/squad/reset` | — | Reset session kill/death counters |
| POST | `/api/gep-event` | GEP payload | Overwolf bridge endpoint |

### WebSocket messages

**Server → overlay:**

```
stats_update       — API stats for solo player
squad_update       — API stats for all squad players
log_squad_stats    — Real-time kill/death counts from log or GEP
log_kill           — Kill detected (local player)
log_match_start    — Match started
log_match_end      — Match ended
log_downed         — Local player downed (death event)
log_party_update   — Party member list changed
log_playlist_change — Game mode detected
gep_kill           — GEP confirmed kill (exact count)
gep_knocked        — GEP: local player downed
gep_death          — GEP: local player eliminated
gep_revived        — GEP: local player revived
gep_match_start    — GEP: match started
gep_match_end      — GEP: match ended (includes placement)
gep_squad_update   — GEP: squad member alive/knocked state
gep_phase          — GEP: game phase (lobby/airfield/ingame/endgame)
theme_change       — Theme switched
loading / idle / error
```

**Overlay → server:**

```
set_player         — { username }
reset_session
refresh
set_theme          — { theme }
squad_reset
```

---

## Project Structure

```
fortnite-obs-overlay/
├── src/
│   ├── server.ts          # Express + WebSocket hub, all state
│   ├── fortnite-api.ts    # fortnite-api.com client
│   ├── stats-tracker.ts   # Session baseline & delta calculation
│   ├── squad-tracker.ts   # Squad polling loop (up to 4 players)
│   ├── log-parser.ts      # FortniteGame.log watcher (confirmed Ch6 patterns)
│   └── config.ts          # RuntimeConfig singleton
├── overlay/
│   ├── shared/theme.css   # All theme CSS variables
│   ├── live/              # Compact in-game overlay  (260 × 160)
│   ├── overview/          # Full stats dashboard     (420 × 380)
│   ├── squad/             # Squad tracker overlay    (dynamic width)
│   └── control/           # Control panel (browser tab)
├── overwolf-bridge/
│   ├── manifest.json      # Overwolf app declaration (game ID 21216)
│   ├── background.html    # Background window shell
│   └── background.js      # GEP subscriber + HTTP forwarder
├── simulate-log.js        # Dev tool: replay all log files, print match report
├── setup.sh / setup.ps1   # First-run setup scripts
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Commands

```bash
npm run dev           # Development — hot reload (ts-node-dev)
bun run dev:bun       # Development — faster startup with Bun
npm run build         # Production build (tsc → dist/)
npm start             # Run production build
npm run release:patch # Bump patch version + push tag
npm run release:minor
npm run release:major
node simulate-log.js  # Replay all Fortnite log files and print match history
```
