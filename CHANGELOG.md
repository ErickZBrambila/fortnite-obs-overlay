# Changelog

All notable changes to this project will be documented here.

Format: [Semantic Versioning](https://semver.org) — `MAJOR.MINOR.PATCH`

---

## [1.1.0] - 2026-03-14

### Added
- **Overwolf GEP bridge** (`overwolf-bridge/`) — background-only Overwolf app that forwards real-time Game Events Provider data to the server via `POST /api/gep-event`
  - Events: kill count, knocked, death, revived, match start/end, placement, squad alive/knocked state, game phase
  - Auto-launches when Fortnite starts
- **`/api/gep-event` endpoint** — receives GEP payloads from the Overwolf bridge and broadcasts as WebSocket messages (`gep_kill`, `gep_knocked`, `gep_death`, `gep_revived`, `gep_match_start`, `gep_match_end`, `gep_squad_update`, `gep_phase`)
- **Squad card alive/knocked status dots** — green (alive), orange pulsing (downed), red (eliminated), driven by GEP data
- **Placement badge** — shows final placement in squad overlay footer for 15 seconds after match ends
- **Death flash animation** — red card flash when local player is eliminated or downed
- **`simulate-log.js`** — dev tool to replay all Fortnite log files and reconstruct full match history with kill analysis, party detection, and playlist breakdown

### Changed
- **`src/log-parser.ts`** — full rewrite using confirmed Fortnite Chapter 6 log patterns
  - Removed dead kill patterns (`KillerName=`, `killed`, `eliminated`) that never appear in modern logs
  - Match start/end now uses verified `LogGameState: Match State Changed` pattern
  - Kill tracking via `AFortPlayerStateAthena::OnRep_Kills()` score increments (monotonic heuristic for local player)
  - New events emitted: `local_kill`, `local_death`, `party_update`, `playlist_change`
- **`src/server.ts`** — updated log parser event handlers to use new event types; GEP kill count syncs to `logSquadStats` so squad overlay LIVE badge reflects accurate counts
- **Squad overlay** — GEP squad state tracked separately from API state; re-renders on GEP update without API round-trip
- **README** — fully rewritten with Overwolf bridge setup, squad configuration guide, accurate log polling docs, updated WebSocket message reference, and project structure

### Fixed
- Squad overlay kill flash now correctly targets player card by `data-username` attribute instead of hardcoded slot

---

## [1.0.0] - 2026-03-08

### Added
- Live overlay — compact session tracker (K/D, kills, deaths, wins, timer)
- Overview overlay — full stats dashboard with all-time + mode breakdown
- Squad tracker overlay
- Control panel — set player, reset session, force refresh
- Real-time WebSocket updates (no page reload needed)
- 3 themes: Fortnite native, Minimal dark, Neon
- Session baseline tracking (delta stats per stream)
- REST API (`/api/player`, `/api/session/reset`, `/api/status`)
- Cross-platform setup scripts (`setup.sh`, `setup.ps1`)
- Configurable port and poll interval via `.env`
