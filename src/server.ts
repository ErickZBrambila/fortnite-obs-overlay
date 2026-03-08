import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { RuntimeConfig, saveConfig } from './config';
import type { SquadPlayer } from './config';
import { fetchPlayerStats } from './fortnite-api';
import type { PlayerStats } from './fortnite-api';
import { setBaseline, hasBaseline, resetBaseline, computeSession } from './stats-tracker';
import { LogParser } from './log-parser';
import { setSquadPlayers, pollSquad, getSquadState } from './squad-tracker';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'overlay')));

let currentUsername: string | null = RuntimeConfig.defaultUsername || null;
let currentStats: PlayerStats | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let squadPollTimer: ReturnType<typeof setInterval> | null = null;
let logParser: LogParser | null = null;

const VALID_THEMES = ['fortnite', 'minimal', 'neon', 'dark', 'gold', 'purple'];

// ─── Broadcast ───────────────────────────────────────────────────────────────

function broadcast(data: object) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

// ─── Log Parser ───────────────────────────────────────────────────────────────

function initLogParser() {
  if (logParser) logParser.stop();
  if (!RuntimeConfig.logFilePath) return;
  logParser = new LogParser(RuntimeConfig.logFilePath);
  logParser.on('kill',        (e) => broadcast({ type: 'log_kill',        ...e }));
  logParser.on('match_start', (e) => broadcast({ type: 'log_match_start', ...e }));
  logParser.on('match_end',   (e) => broadcast({ type: 'log_match_end',   ...e }));
  logParser.on('placement',   (e) => broadcast({ type: 'log_placement',   ...e }));
  logParser.on('downed',      (e) => broadcast({ type: 'log_downed',      ...e }));
  logParser.start();
}

// ─── Fetch & Broadcast (single player) ───────────────────────────────────────

async function fetchAndBroadcast() {
  if (!currentUsername) return;
  const username = currentUsername;

  try {
    const stats = await fetchPlayerStats(username, RuntimeConfig.apiKey);
    console.log(`[poll] ${username} — LVL ${stats.battlePass.level} | K:${stats.stats.overall.kills} W:${stats.stats.overall.wins} M:${stats.stats.overall.matches} | updated: ${stats.lastUpdated}`);

    if (!hasBaseline(username)) {
      setBaseline(username, stats);
      console.log(`[poll] baseline set for ${username}`);
    }

    const session = computeSession(username, stats);
    console.log(`[poll] session — kills:${session.kills} deaths:${session.deaths} matches:${session.matches} wins:${session.wins}`);
    currentStats = stats;

    broadcast({
      type: 'stats_update',
      player: stats.account.name,
      battlePass: stats.battlePass,
      stats: stats.stats,
      session,
      lastUpdated: stats.lastUpdated,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[poll] ${message}`);
    broadcast({ type: 'error', message });
  }
}

// ─── Squad Poll & Broadcast ───────────────────────────────────────────────────

async function pollAndBroadcastSquad() {
  const enabled = RuntimeConfig.squadPlayers.filter(p => p.enabled);
  if (enabled.length === 0) return;
  try {
    const state = await pollSquad(RuntimeConfig.apiKey);
    broadcast({ type: 'squad_update', ...state });
  } catch (err: unknown) {
    console.error(`[squad] ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

// ─── Polling ─────────────────────────────────────────────────────────────────

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  fetchAndBroadcast();
  pollTimer = setInterval(fetchAndBroadcast, RuntimeConfig.pollIntervalMs);
}

function startSquadPolling() {
  if (squadPollTimer) clearInterval(squadPollTimer);
  pollAndBroadcastSquad();
  squadPollTimer = setInterval(pollAndBroadcastSquad, RuntimeConfig.pollIntervalMs);
}

// ─── WebSocket ───────────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  console.log('[ws] client connected');

  // Always send current theme first
  ws.send(JSON.stringify({ type: 'theme_change', theme: RuntimeConfig.activeTheme }));

  // Single-player state
  if (currentUsername && currentStats) {
    const session = computeSession(currentUsername, currentStats);
    ws.send(JSON.stringify({
      type: 'stats_update',
      player: currentStats.account.name,
      battlePass: currentStats.battlePass,
      stats: currentStats.stats,
      session,
      lastUpdated: currentStats.lastUpdated,
    }));
  } else if (currentUsername) {
    ws.send(JSON.stringify({ type: 'loading', player: currentUsername }));
  } else {
    ws.send(JSON.stringify({ type: 'idle' }));
  }

  // Squad state
  const squadState = getSquadState();
  if (squadState.players.length > 0) {
    ws.send(JSON.stringify({ type: 'squad_update', ...squadState }));
  }

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as {
        type: string;
        username?: string;
        theme?: string;
      };

      switch (msg.type) {
        case 'set_player': {
          const username = msg.username?.trim();
          if (!username) return;
          currentUsername = username;
          currentStats = null;
          broadcast({ type: 'loading', player: username });
          startPolling();
          break;
        }
        case 'reset_session': {
          if (currentUsername && currentStats) {
            resetBaseline(currentUsername, currentStats);
            await fetchAndBroadcast();
          }
          break;
        }
        case 'refresh': {
          await fetchAndBroadcast();
          break;
        }
        case 'set_theme': {
          const theme = msg.theme;
          if (!theme || !VALID_THEMES.includes(theme)) return;
          RuntimeConfig.activeTheme = theme;
          saveConfig();
          broadcast({ type: 'theme_change', theme });
          break;
        }
        case 'squad_reset': {
          await pollAndBroadcastSquad();
          break;
        }
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on('close', () => console.log('[ws] client disconnected'));
});

// ─── REST API ─────────────────────────────────────────────────────────────────

app.post('/api/player', (req, res) => {
  const { username } = req.body as { username?: string };
  if (!username?.trim()) {
    res.status(400).json({ error: 'username is required' });
    return;
  }
  currentUsername = username.trim();
  currentStats = null;
  broadcast({ type: 'loading', player: currentUsername });
  startPolling();
  res.json({ ok: true, player: currentUsername });
});

app.post('/api/session/reset', (_req, res) => {
  if (!currentUsername || !currentStats) {
    res.status(400).json({ error: 'No active player' });
    return;
  }
  resetBaseline(currentUsername, currentStats);
  fetchAndBroadcast();
  res.json({ ok: true });
});

app.get('/api/status', (_req, res) => {
  res.json({
    player: currentUsername,
    polling: pollTimer !== null,
    pollIntervalMs: RuntimeConfig.pollIntervalMs,
  });
});

// ─── Config API ───────────────────────────────────────────────────────────────

app.get('/api/config', (_req, res) => {
  res.json({
    apiKey:          RuntimeConfig.apiKey,
    pollIntervalMs:  RuntimeConfig.pollIntervalMs,
    defaultUsername: RuntimeConfig.defaultUsername,
    activeTheme:     RuntimeConfig.activeTheme,
    squadPlayers:    RuntimeConfig.squadPlayers,
    logFilePath:     RuntimeConfig.logFilePath,
  });
});

app.post('/api/config', (req, res) => {
  const body = req.body as {
    apiKey?: string;
    pollIntervalMs?: number;
    defaultUsername?: string;
    activeTheme?: string;
    logFilePath?: string;
  };

  if (body.apiKey !== undefined) {
    RuntimeConfig.apiKey = body.apiKey.trim();
  }

  if (body.pollIntervalMs !== undefined) {
    const ms = Number(body.pollIntervalMs);
    if (isNaN(ms) || ms < 10000) {
      res.status(400).json({ error: 'pollIntervalMs must be >= 10000' });
      return;
    }
    RuntimeConfig.pollIntervalMs = ms;
  }

  if (body.defaultUsername !== undefined) {
    RuntimeConfig.defaultUsername = body.defaultUsername.trim();
  }

  if (body.activeTheme !== undefined) {
    if (!VALID_THEMES.includes(body.activeTheme)) {
      res.status(400).json({ error: 'invalid theme' });
      return;
    }
    RuntimeConfig.activeTheme = body.activeTheme;
    broadcast({ type: 'theme_change', theme: body.activeTheme });
  }

  if (body.logFilePath !== undefined) {
    RuntimeConfig.logFilePath = body.logFilePath.trim();
    initLogParser();
  }

  saveConfig();
  if (currentUsername) startPolling();

  res.json({ ok: true });
});

// ─── Squad API ────────────────────────────────────────────────────────────────

app.get('/api/squad', (_req, res) => {
  res.json({ players: RuntimeConfig.squadPlayers });
});

app.post('/api/squad', (req, res) => {
  const { players } = req.body as { players?: SquadPlayer[] };
  if (!Array.isArray(players)) {
    res.status(400).json({ error: 'players array required' });
    return;
  }
  if (players.length > 4) {
    res.status(400).json({ error: 'max 4 squad players' });
    return;
  }
  RuntimeConfig.squadPlayers = players;
  saveConfig();
  setSquadPlayers(players);
  startSquadPolling();
  res.json({ ok: true });
});

app.post('/api/squad/reset', (_req, res) => {
  pollAndBroadcastSquad();
  res.json({ ok: true });
});

// ─── Start ────────────────────────────────────────────────────────────────────

if (currentUsername) startPolling();

if (RuntimeConfig.squadPlayers.filter(p => p.enabled).length > 0) {
  setSquadPlayers(RuntimeConfig.squadPlayers);
  startSquadPolling();
}

if (RuntimeConfig.logFilePath) initLogParser();

server.listen(RuntimeConfig.port, () => {
  console.log(`\nFortnite OBS Overlay`);
  console.log(`  Server:           http://localhost:${RuntimeConfig.port}`);
  console.log(`  Live overlay:     http://localhost:${RuntimeConfig.port}/live/`);
  console.log(`  Overview overlay: http://localhost:${RuntimeConfig.port}/overview/`);
  console.log(`  Squad overlay:    http://localhost:${RuntimeConfig.port}/squad/`);
  console.log(`  Control panel:    http://localhost:${RuntimeConfig.port}/control/`);
  console.log(`  Poll interval:    ${RuntimeConfig.pollIntervalMs / 1000}s`);
  console.log(`  Theme:            ${RuntimeConfig.activeTheme}`);
  if (RuntimeConfig.squadPlayers.length > 0) {
    console.log(`  Squad:            ${RuntimeConfig.squadPlayers.map(p => `${p.username} (${p.platform})`).join(', ')}`);
  }
  if (RuntimeConfig.logFilePath) {
    console.log(`  Log file:         ${RuntimeConfig.logFilePath}`);
  }
  console.log('');
  if (!RuntimeConfig.apiKey) {
    console.warn('  WARNING: FORTNITE_API_KEY is not set.\n');
  }
  if (!currentUsername) {
    console.log('  No player set. Open the control panel to enter an Epic username.\n');
  }
});
