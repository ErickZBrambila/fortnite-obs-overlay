# Changelog

All notable changes to this project will be documented here.

Format: [Semantic Versioning](https://semver.org) — `MAJOR.MINOR.PATCH`

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
