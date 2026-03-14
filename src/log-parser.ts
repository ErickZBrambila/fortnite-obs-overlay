import { EventEmitter } from 'events';
import fs from 'fs';
import readline from 'readline';

// ─── Event interfaces ─────────────────────────────────────────────────────────

export interface MatchStartEvent {
  gameMode: string;
  playlist: string;
  timestamp: string;
}

export interface MatchEndEvent {
  timestamp: string;
}

/** Best-effort local player kill — derived from KillScore monotonic increments */
export interface LocalKillEvent {
  score: number;      // cumulative kill count this match
  timestamp: string;
}

export interface LocalDeathEvent {
  timestamp: string;
}

export interface PartyUpdateEvent {
  players: string[];  // all current party members including local player
  timestamp: string;
}

export interface PlaylistChangeEvent {
  playlist: string;
  timestamp: string;
}

// ─── Timestamp parsing ────────────────────────────────────────────────────────

// [2024.01.15-18.32.41:123]
const LOG_TS = /^\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):\d{3}\]/;

function parseTimestamp(line: string): string {
  const m = line.match(LOG_TS);
  if (!m) return new Date().toISOString();
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`).toISOString();
}

// ─── Confirmed Fortnite Chapter 6 log patterns ────────────────────────────────

const P_MATCH_START = /LogGameState: Match State Changed from WaitingToStart to InProgress/;
const P_MATCH_END   = /Log(?:GameState|GameMode.*Display): Match State Changed from \w+ to LeavingMap/;
const P_LOGIN       = /process_user_login.*DisplayName=\[([^\]]+)\]/;
const P_PARTY_ADD   = /New party member state for \[([^\]]+)\]/;
const P_PLAYLIST    = /PLAYLIST: Playlist Object finished loading.*PlaylistName is ([\w_]+)/;
const P_KILL_SCORE  = /AFortPlayerStateAthena::OnRep_Kills\(\) \(KillScore = (\d+)\)/;
const P_DEATH_LOCAL = /LogSpectateAfterDeathViewTarget.*\[([^\]]+)\]\s+No teammates/;

// ─── Playlist → game mode mapping ─────────────────────────────────────────────

const MODE_MAP: Array<[string, RegExp]> = [
  ['squad', /NoBuildBR_Squad|DefaultSquad/i],
  ['duo',   /NoBuildBR_Duo|ForbiddenFruit|DefaultDuo/i],
  ['solo',  /NoBuildBR_Solo|DefaultSolo/i],
];

function modeFromPlaylist(playlist: string): string {
  for (const [mode, re] of MODE_MAP) {
    if (re.test(playlist)) return mode;
  }
  return 'unknown';
}

// ─── LogParser ────────────────────────────────────────────────────────────────

export class LogParser extends EventEmitter {
  private logPath: string;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private fileSize = 0;

  // Per-session state
  private localPlayer = '';
  private party = new Set<string>();
  private currentPlaylist = '';
  private inMatch = false;
  private lastKillScore = 0;  // last accepted local-player kill score this match

  constructor(logPath: string) {
    super();
    this.logPath = logPath;
  }

  start(): void {
    try {
      this.fileSize = fs.statSync(this.logPath).size;
    } catch {
      console.warn(`[log] File not found: ${this.logPath}`);
      this.fileSize = 0;
    }
    this.watchTimer = setInterval(() => this.checkNewContent(), 500);
    console.log(`[log] Watching: ${this.logPath}`);
  }

  stop(): void {
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
  }

  setPath(newPath: string): void {
    this.stop();
    this.logPath = newPath;
    this.start();
  }

  get localPlayerName(): string {
    return this.localPlayer;
  }

  private checkNewContent(): void {
    let stat: fs.Stats;
    try { stat = fs.statSync(this.logPath); } catch { return; }

    const newSize = stat.size;
    if (newSize === this.fileSize) return;
    if (newSize < this.fileSize) this.fileSize = 0; // log rotated

    const start = this.fileSize;
    this.fileSize = newSize;

    const stream = fs.createReadStream(this.logPath, {
      start,
      end: newSize - 1,
      encoding: 'utf8',
    });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => this.parseLine(line));
  }

  private parseLine(line: string): void {
    if (!line.trim()) return;
    const timestamp = parseTimestamp(line);
    let m: RegExpMatchArray | null;

    // ── Login: track local player name and reset party
    if ((m = line.match(P_LOGIN))) {
      this.localPlayer = m[1];
      this.party = new Set([this.localPlayer]);
      console.log(`[log] Local player: ${this.localPlayer}`);
      return;
    }

    // ── Party member added
    if ((m = line.match(P_PARTY_ADD))) {
      const added = m[1];
      if (!this.party.has(added)) {
        this.party.add(added);
        const players = [...this.party];
        console.log(`[log] Party update: ${players.join(', ')}`);
        this.emit('party_update', { players, timestamp } as PartyUpdateEvent);
      }
      return;
    }

    // ── Playlist detected
    if ((m = line.match(P_PLAYLIST))) {
      this.currentPlaylist = m[1];
      console.log(`[log] Playlist: ${this.currentPlaylist}`);
      this.emit('playlist_change', { playlist: this.currentPlaylist, timestamp } as PlaylistChangeEvent);
      return;
    }

    // ── Match start
    if (P_MATCH_START.test(line)) {
      this.inMatch = true;
      this.lastKillScore = 0;
      const gameMode = modeFromPlaylist(this.currentPlaylist);
      console.log(`[log] Match start — mode: ${gameMode} (${this.currentPlaylist})`);
      this.emit('match_start', { gameMode, playlist: this.currentPlaylist, timestamp } as MatchStartEvent);
      return;
    }

    // ── Match end
    if (P_MATCH_END.test(line)) {
      this.inMatch = false;
      console.log('[log] Match end');
      this.emit('match_end', { timestamp } as MatchEndEvent);
      return;
    }

    // ── Local player death
    if ((m = line.match(P_DEATH_LOCAL))) {
      // This line fires when local player dies with no teammates left — always local player
      console.log(`[log] Local player death`);
      this.emit('local_death', { timestamp } as LocalDeathEvent);
      return;
    }

    // ── Kill score increment (best-effort local player kill tracking)
    // OnRep_Kills fires for all players interleaved, with no player name.
    // Heuristic: accept score N only if N == lastKillScore + 1 (sequential increment).
    if (this.inMatch && (m = line.match(P_KILL_SCORE))) {
      const score = parseInt(m[1]);
      if (score === this.lastKillScore + 1) {
        this.lastKillScore = score;
        console.log(`[log] Kill score: ${score} (estimated local player)`);
        this.emit('local_kill', { score, timestamp } as LocalKillEvent);
      }
    }
  }
}
