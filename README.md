# Fortnite OBS Overlay

Real-time Fortnite player stats overlay for OBS Studio. Tracks live session stats and all-time statistics via the [fortnite-api.com](https://fortnite-api.com) API.

## Features

- **Live overlay** — compact session tracker (K/D, kills, deaths, wins, session timer)
- **Overview overlay** — full stats dashboard with all-time stats and mode breakdown (Solos / Duos / Squads)
- **Control panel** — browser-based panel to set player, reset session, and force refresh
- **Real-time updates** via WebSocket (no page reload needed)
- **3 themes**: Fortnite native (default), Minimal dark, Neon
- **Configurable** poll interval, port, and default player

---

## Getting Your Fortnite API Key

1. Go to [https://fortnite-api.com](https://fortnite-api.com)
2. Click **"Get API Key"** in the top navigation
3. Sign in with your Discord account (required for free API access)
4. Your API key will be displayed on the dashboard — copy it
5. The free tier allows up to **100 requests/minute**, which is more than enough for this overlay

---

## Setup

### Quick setup (recommended)

The setup scripts check your environment, install dependencies, and create your `.env` file automatically.

**macOS / Linux:**
```bash
chmod +x setup.sh && ./setup.sh
```

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1
```

> If PowerShell blocks the script, run `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` first (one-time).

---

### Manual setup

#### Prerequisites

| Platform | Requirement |
|----------|-------------|
| All      | [Node.js](https://nodejs.org) v18 or later |
| Optional | [Bun](https://bun.sh) for faster dev startup |

**Install Bun (optional but recommended):**
- macOS / Linux: `curl -fsSL https://bun.sh/install | bash`
- Windows: `powershell -c "irm bun.sh/install.ps1 | iex"` (in PowerShell)

#### 1. Install dependencies

With Bun:
```bash
bun install
```

With npm (Node.js only, no Bun):
```bash
npm install
```

#### 2. Configure environment

**macOS / Linux:**
```bash
cp .env.example .env
```

**Windows (PowerShell or CMD):**
```powershell
copy .env.example .env
```

Open `.env` and fill in:

```env
FORTNITE_API_KEY=your_api_key_here

# Optional: pre-load a player when the server starts
DEFAULT_USERNAME=YourEpicUsername

# Server port (default: 3000)
PORT=3000

# Poll interval in milliseconds (default: 30s — don't go below 15000)
POLL_INTERVAL_MS=30000
```

#### 3. Run the server

With Bun:
```bash
bun run dev:bun
```

With npm (Node.js):
```bash
npm run dev
```

The server will print the URLs for each overlay and the control panel.

---

## Adding to OBS Studio

### Live Overlay (in-game corner overlay)

1. In OBS, add a **Browser Source**
2. URL: `http://localhost:3000/live/`
3. Width: `260`, Height: `160`
4. Check **"Refresh browser when scene becomes active"**

### Overview / Stats Dashboard

1. Add a **Browser Source**
2. URL: `http://localhost:3000/overview/`
3. Width: `420`, Height: `380`
4. Check **"Refresh browser when scene becomes active"**

### Setting a Player

Open the **Control Panel** in your regular browser: `http://localhost:3000/control/`

Enter the Epic username and click **Track Player**. All connected overlays update instantly.

Alternatively, set `DEFAULT_USERNAME` in `.env` to auto-load a player on server start.

---

## Theming

Change the theme by editing the `data-theme` attribute on the `<body>` tag in the overlay HTML files:

```html
<!-- overlay/live/index.html -->
<body data-theme="fortnite">   <!-- default: Fortnite native blue -->
<body data-theme="minimal">    <!-- clean dark monochrome -->
<body data-theme="neon">       <!-- purple/cyan neon -->
```

To add a custom theme, add a new `[data-theme="yourtheme"]` block to `overlay/shared/theme.css` and override the CSS variables.

---

## Session Tracking

Session stats are calculated as the **delta between your stats when tracking started and now**. This means:

- Stats only count **after** you start tracking
- Use **Reset Session** in the control panel to zero out the session (e.g. start of stream)
- Session resets automatically if you restart the server with the same player

---

## API Reference (REST)

| Method | Endpoint             | Body                      | Description              |
|--------|----------------------|---------------------------|--------------------------|
| POST   | `/api/player`        | `{ "username": "..." }`   | Set active player        |
| POST   | `/api/session/reset` | —                         | Reset session baseline   |
| GET    | `/api/status`        | —                         | Server/polling status    |

## WebSocket Messages

**From overlay to server:**
```json
{ "type": "set_player", "username": "EpicName" }
{ "type": "reset_session" }
{ "type": "refresh" }
```

**From server to overlay:**
```json
{ "type": "stats_update", "player": "...", "battlePass": {...}, "stats": {...}, "session": {...}, "lastUpdated": "..." }
{ "type": "loading", "player": "..." }
{ "type": "error", "message": "..." }
{ "type": "idle" }
```

---

## Project Structure

```
fortnite-obs-overlay/
├── src/
│   ├── server.ts          # Express + WebSocket server
│   ├── fortnite-api.ts    # Fortnite API client
│   ├── stats-tracker.ts   # Session baseline & delta calculation
│   ├── squad-tracker.ts   # Squad overlay tracking
│   ├── log-parser.ts      # Log parsing utilities
│   └── config.ts          # Env config
├── overlay/
│   ├── shared/
│   │   └── theme.css      # CSS variables for all themes
│   ├── live/              # Compact in-game overlay (260x160)
│   ├── overview/          # Full stats dashboard (420x380)
│   ├── squad/             # Squad tracker overlay
│   └── control/           # Control panel (open in browser)
├── setup.sh               # macOS / Linux setup script
├── setup.ps1              # Windows PowerShell setup script
├── .env.example
├── package.json
└── tsconfig.json
```
