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
import type { LocalKillEvent, LocalDeathEvent, PartyUpdateEvent, PlaylistChangeEvent } from './log-parser';
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

// Real-time kill/death counters derived from log — keyed by lowercase username
const logSquadStats = new Map<string, { kills: number; deaths: number }>();

function squadUsernames(): Set<string> {
  return new Set(
    RuntimeConfig.squadPlayers
      .filter(p => p.enabled && p.username.trim())
      .map(p => p.username.toLowerCase())
  );
}

function broadcastLogSquadStats() {
  const stats: Record<string, { kills: number; deaths: number }> = {};
  logSquadStats.forEach((v, k) => { stats[k] = v; });
  broadcast({ type: 'log_squad_stats', stats });
}

const VALID_THEMES = ['fortnite', 'minimal', 'neon', 'dark', 'gold', 'purple', 'glass', 'liquid'];

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

  logParser.on('match_start', (e) => {
    broadcast({ type: 'log_match_start', ...e });
    logSquadStats.clear();
    broadcastLogSquadStats();
  });

  logParser.on('match_end', (e) => {
    broadcast({ type: 'log_match_end', ...e });
  });

  // Best-effort local player kill — OnRep_Kills monotonic increment
  logParser.on('local_kill', (e: LocalKillEvent) => {
    const key = (currentUsername ?? '').toLowerCase();
    if (!key) return;
    const s = logSquadStats.get(key) ?? { kills: 0, deaths: 0 };
    s.kills = e.score;  // score IS the cumulative kill count
    logSquadStats.set(key, s);
    broadcastLogSquadStats();
    broadcast({ type: 'log_kill', killer: currentUsername, score: e.score, timestamp: e.timestamp });
  });

  logParser.on('local_death', (e: LocalDeathEvent) => {
    const key = (currentUsername ?? '').toLowerCase();
    if (!key) return;
    const s = logSquadStats.get(key) ?? { kills: 0, deaths: 0 };
    s.deaths++;
    logSquadStats.set(key, s);
    broadcastLogSquadStats();
    broadcast({ type: 'log_downed', timestamp: e.timestamp });
  });

  logParser.on('party_update', (e: PartyUpdateEvent) => {
    broadcast({ type: 'log_party_update', ...e });
  });

  logParser.on('playlist_change', (e: PlaylistChangeEvent) => {
    broadcast({ type: 'log_playlist_change', ...e });
  });

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

  // Send current log-derived squad stats
  const currentLogStats: Record<string, { kills: number; deaths: number }> = {};
  logSquadStats.forEach((v, k) => { currentLogStats[k] = v; });
  ws.send(JSON.stringify({ type: 'log_squad_stats', stats: currentLogStats }));

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
          logSquadStats.clear();
          broadcastLogSquadStats();
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
  logSquadStats.clear();
  broadcastLogSquadStats();
  startSquadPolling();
  res.json({ ok: true });
});

app.post('/api/squad/reset', (_req, res) => {
  logSquadStats.clear();
  broadcastLogSquadStats();
  pollAndBroadcastSquad();
  res.json({ ok: true });
});

// ─── Overwolf GEP Bridge ──────────────────────────────────────────────────────
// Receives events forwarded by the Overwolf background app (overwolf-bridge/)
// and maps them to WebSocket broadcasts the overlay already understands.

interface GepPayload {
  type:     'event' | 'info';
  name?:    string;              // for type=event
  feature?: string;              // for type=info
  data?:    Record<string, unknown>;
  info?:    Record<string, unknown>;
}

// Sparse map: lowercase player name → { isAlive, isKnocked }
const gepSquadState = new Map<string, { isAlive: boolean; isKnocked: boolean }>();

app.post('/api/gep-event', (req, res) => {
  const payload = req.body as GepPayload;
  res.json({ ok: true }); // always ack immediately

  if (payload.type === 'event') {
    const { name, data = {} } = payload;

    switch (name) {
      case 'kill': {
        const kills = parseInt(String(data.kills ?? '0'));
        // Update logSquadStats so the squad overlay LIVE badge reflects GEP kills
        const key = (currentUsername ?? '').toLowerCase();
        if (key) {
          const s = logSquadStats.get(key) ?? { kills: 0, deaths: 0 };
          s.kills = kills;
          logSquadStats.set(key, s);
          broadcastLogSquadStats();
        }
        broadcast({ type: 'gep_kill', kills });
        break;
      }
      case 'death':
        broadcast({ type: 'gep_death' });
        break;
      case 'knocked_out':
        broadcast({ type: 'gep_knocked' });
        break;
      case 'revived':
        broadcast({ type: 'gep_revived' });
        break;
      case 'match_end': {
        const placement    = parseInt(String(data.rank ?? data.placement ?? '0'));
        const totalPlayers = parseInt(String(data.alive_players ?? data.totalPlayers ?? '0'));
        broadcast({ type: 'gep_match_end', placement, totalPlayers });
        break;
      }
      case 'game_exit':
        gepSquadState.clear();
        broadcast({ type: 'gep_squad_update', members: [] });
        break;
    }

  } else if (payload.type === 'info') {
    const { feature, info = {} } = payload;

    if (feature === 'team') {
      // info shape: { match_info: { team_member_0: '{"name":"...","is_alive":true,...}', ... } }
      const matchInfo = (info.match_info ?? {}) as Record<string, string>;
      Object.entries(matchInfo).forEach(([key, val]) => {
        if (!key.startsWith('team_member_')) return;
        try {
          const member = typeof val === 'string' ? JSON.parse(val) : val;
          const name = String(member.name ?? '').toLowerCase();
          if (!name) return;
          gepSquadState.set(name, {
            isAlive:   Boolean(member.is_alive ?? true),
            isKnocked: Boolean(member.is_knocked ?? false),
          });
        } catch { /* malformed */ }
      });
      broadcast({
        type:    'gep_squad_update',
        members: [...gepSquadState.entries()].map(([name, s]) => ({ name, ...s })),
      });
    }

    if (feature === 'rank') {
      const rankInfo  = (info.match_info ?? {}) as Record<string, string>;
      const placement = parseInt(String(rankInfo.rank ?? '0'));
      const total     = parseInt(String(rankInfo.alive_players ?? '0'));
      if (placement > 0) broadcast({ type: 'gep_match_end', placement, totalPlayers: total });
    }

    if (feature === 'phase') {
      const gameInfo = (info.game_info ?? {}) as Record<string, string>;
      const phase    = String(gameInfo.phase ?? '');
      if (phase) broadcast({ type: 'gep_phase', phase });
    }

    if (feature === 'match_info') {
      const matchInfo = (info.match_info ?? {}) as Record<string, string>;
      if (matchInfo.match_started === '1') {
        gepSquadState.clear();
        logSquadStats.clear();
        broadcastLogSquadStats();
        broadcast({ type: 'gep_match_start', gameMode: String(matchInfo.game_mode ?? '') });
      }
      if (matchInfo.match_ended === '1') {
        broadcast({ type: 'gep_match_end', placement: 0, totalPlayers: 0 });
      }
    }
  }
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
