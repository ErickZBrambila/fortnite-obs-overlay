import { EventEmitter } from 'events';
import fs from 'fs';
import readline from 'readline';

export interface KillEvent {
  victim: string;
  weapon: string;
  timestamp: string;
}

export interface MatchStartEvent {
  gameMode: string;
  timestamp: string;
}

export interface MatchEndEvent {
  placement: number;
  totalPlayers: number;
  timestamp: string;
}

export interface DownedEvent {
  killer: string;
  weapon: string;
  timestamp: string;
}

// FortniteGame.log timestamp: [2024.01.15-18.32.41:123]
const LOG_TS = /^\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):\d{3}\]/;

function parseTimestamp(line: string): string {
  const m = line.match(LOG_TS);
  if (!m) return new Date().toISOString();
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`).toISOString();
}

// ─── Kill patterns (tried in order, multiple Fortnite version formats) ────────
const KILL_PATTERNS: RegExp[] = [
  // Structured: KillerName=X ... VictimName=Y ... WeaponType=Z
  /KillerName[=: ]+([A-Za-z0-9_.\-]{3,}).*?(?:VictimName|KilledName)[=: ]+([A-Za-z0-9_.\-]{3,}).*?(?:WeaponType|Weapon)[=: ]+([A-Za-z0-9_.\-]+)/i,
  // "X killed Y with Z"
  /LogFort[^:]*:\s*([A-Za-z0-9_.\-]{3,})\s+killed\s+([A-Za-z0-9_.\-]{3,})\s+with\s+([A-Za-z0-9_.\- ]+)/i,
  // "X eliminated Y"
  /LogAthena[^:]*:\s*([A-Za-z0-9_.\-]{3,})\s+eliminated\s+([A-Za-z0-9_.\-]{3,})/i,
  // Elimination event with victim only
  /Elimination.*?Victim[=: ]+([A-Za-z0-9_.\-]{3,}).*?(?:Weapon|WeaponType)[=: ]+([A-Za-z0-9_.\-]+)/i,
];

// ─── Match state ──────────────────────────────────────────────────────────────
const MATCH_START = /WaitingToStart.*InProgress|BroadcastMatchStateChange.*InProgress/i;
const MATCH_END   = /InProgress.*WaitingPostMatch|FinishingMatch|AthenaEndGame/i;

// ─── Placement ────────────────────────────────────────────────────────────────
const PLACEMENT_PATTERNS: RegExp[] = [
  /Place[d]?\s*=\s*(\d+)[,\s]+(?:NumPlayers|Total)\s*=\s*(\d+)/i,
  /placed\s*#?(\d+)\s*(?:\/|of|out of)\s*(\d+)/i,
  /Victory.*?#(\d+)\s*\/\s*(\d+)/i,
  /rank[=: ]+(\d+)[,\s]+total[=: ]+(\d+)/i,
];

// ─── Game mode ────────────────────────────────────────────────────────────────
const MODE_MAP: Array<[string, RegExp]> = [
  ['squad', /playlist.*?squad|PlaylistName.*?squad|GameMode.*?Squad/i],
  ['duo',   /playlist.*?duo|PlaylistName.*?duo|GameMode.*?Duo/i],
  ['solo',  /playlist.*?solo|PlaylistName.*?solo|GameMode.*?Solo/i],
];

// ─── Downed (local player knocked) ───────────────────────────────────────────
const DOWNED_PATTERNS: RegExp[] = [
  /LocalPlayer.*DBNO|LogFort.*LocalPlayer.*eliminated/i,
  /KillerName=[A-Za-z0-9_.\-]+.*LocalPlayer.*DBNO/i,
];

export class LogParser extends EventEmitter {
  private logPath: string;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private fileSize = 0;

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

    // Match start
    if (MATCH_START.test(line)) {
      let gameMode = 'unknown';
      for (const [mode, re] of MODE_MAP) {
        if (re.test(line)) { gameMode = mode; break; }
      }
      console.log(`[log] Match start — mode: ${gameMode}`);
      this.emit('match_start', { gameMode, timestamp } as MatchStartEvent);
      return;
    }

    // Match end
    if (MATCH_END.test(line)) {
      let placement = 0, totalPlayers = 0;
      for (const re of PLACEMENT_PATTERNS) {
        const m = line.match(re);
        if (m) { placement = parseInt(m[1]); totalPlayers = parseInt(m[2]); break; }
      }
      console.log(`[log] Match end — placement: #${placement}/${totalPlayers}`);
      this.emit('match_end', { placement, totalPlayers, timestamp } as MatchEndEvent);
      return;
    }

    // Standalone placement lines
    for (const re of PLACEMENT_PATTERNS) {
      const m = line.match(re);
      if (m) {
        const placement = parseInt(m[1]);
        const totalPlayers = parseInt(m[2]);
        if (placement > 0 && totalPlayers > 1) {
          console.log(`[log] Placement: #${placement}/${totalPlayers}`);
          this.emit('placement', { placement, totalPlayers, timestamp } as MatchEndEvent);
        }
        break;
      }
    }

    // Kills
    for (const re of KILL_PATTERNS) {
      const m = line.match(re);
      if (m) {
        const event: KillEvent = {
          victim: m[2] ?? m[1],
          weapon: m[3] ?? 'unknown',
          timestamp,
        };
        console.log(`[log] Kill — victim: ${event.victim}, weapon: ${event.weapon}`);
        this.emit('kill', event);
        return;
      }
    }

    // Downed
    for (const re of DOWNED_PATTERNS) {
      if (re.test(line)) {
        console.log('[log] Player downed');
        this.emit('downed', { killer: 'unknown', weapon: 'unknown', timestamp } as DownedEvent);
        return;
      }
    }

    // Game mode mid-match
    for (const [mode, re] of MODE_MAP) {
      if (re.test(line)) {
        this.emit('mode_detected', { mode, timestamp });
        break;
      }
    }
  }
}
