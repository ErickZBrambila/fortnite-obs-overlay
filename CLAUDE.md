# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (with hot reload)
npm run dev           # ts-node-dev, watches src/ and .env
bun run dev:bun       # faster startup with Bun

# Production
npm run build         # tsc → dist/
npm start             # node dist/server.js

# Versioning (auto-pushes tags)
npm run release:patch
npm run release:minor
npm run release:major
```

No test suite — verify changes by running the dev server and checking the overlay in a browser.

## Architecture

The app is a Node.js/TypeScript server that:
1. Polls `fortnite-api.com` on a configurable interval
2. Broadcasts stats to all connected overlay pages via WebSocket
3. Serves static overlay HTML/CSS/JS from `overlay/`

### Data flow

```
fortnite-api.com  →  fortnite-api.ts  →  server.ts  →  WebSocket broadcast
FortniteGame.log  →  log-parser.ts    →  server.ts  →  WebSocket broadcast
```

**`src/server.ts`** — central hub. Manages the poll timer, WebSocket connections, REST endpoints, and log parser lifecycle. All state lives here (`currentUsername`, `currentStats`, timers).

**`src/config.ts`** — `RuntimeConfig` is a mutable singleton. On startup it merges `.env` values with `config.json` (persisted runtime settings). `saveConfig()` writes back to `config.json`; port is always sourced from `.env` only.

**`src/stats-tracker.ts`** — session stats are computed as deltas from a stored baseline. The baseline is set on first poll for a player and can be reset via the control panel. Baselines are in-memory only (lost on server restart).

**`src/log-parser.ts`** — `LogParser extends EventEmitter`. Polls the log file every 500ms by tracking file size changes and reading only new bytes. Events: `kill`, `match_start`, `match_end`, `placement`, `downed`.

**`src/squad-tracker.ts`** — separate polling loop for up to 4 squad players. Runs on the same `pollIntervalMs`.

### Overlay pages

Each overlay in `overlay/<name>/` is standalone HTML+CSS+JS with no build step. The JS opens a WebSocket to the server and renders incoming messages. Theme is applied by setting `data-theme` on `<body>` — themes are CSS variable blocks in `overlay/shared/theme.css`.

### Config precedence

`.env` (port, API key, defaults) → overridden by `config.json` (runtime changes saved from control panel/API) → `RuntimeConfig` singleton used everywhere.

### WebSocket message types

**Server → clients:** `stats_update`, `squad_update`, `theme_change`, `loading`, `error`, `idle`, `log_kill`, `log_match_start`, `log_match_end`, `log_placement`, `log_downed`

**Client → server:** `set_player`, `reset_session`, `refresh`, `set_theme`, `squad_reset`

### Valid themes

`fortnite` (default), `minimal`, `neon`, `dark`, `gold`, `purple`, `glass` — defined as `[data-theme="..."]` blocks in `overlay/shared/theme.css` using CSS custom properties.
