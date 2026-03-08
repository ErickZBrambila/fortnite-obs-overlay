import type { PlayerStats } from './fortnite-api';

export interface SessionStats {
  kills: number;
  deaths: number;
  matches: number;
  wins: number;
  kd: number;
  winRate: number;
  startTime: string;
  activeMode: 'solo' | 'duo' | 'squad' | 'overall' | null;
}

interface Baseline {
  stats: PlayerStats;
  startTime: Date;
}

const baselines = new Map<string, Baseline>();

function key(username: string) {
  return username.toLowerCase();
}

export function setBaseline(username: string, stats: PlayerStats): void {
  baselines.set(key(username), { stats, startTime: new Date() });
}

export function hasBaseline(username: string): boolean {
  return baselines.has(key(username));
}

export function resetBaseline(username: string, stats: PlayerStats): void {
  setBaseline(username, stats);
}

export function computeSession(username: string, current: PlayerStats): SessionStats {
  const baseline = baselines.get(key(username));
  const startTime = baseline?.startTime.toISOString() ?? new Date().toISOString();

  if (!baseline) {
    return { kills: 0, deaths: 0, matches: 0, wins: 0, kd: 0, winRate: 0, startTime, activeMode: null };
  }

  const kills = Math.max(0, current.stats.overall.kills - baseline.stats.stats.overall.kills);
  const deaths = Math.max(0, current.stats.overall.deaths - baseline.stats.stats.overall.deaths);
  const matches = Math.max(0, current.stats.overall.matches - baseline.stats.stats.overall.matches);
  const wins = Math.max(0, current.stats.overall.wins - baseline.stats.stats.overall.wins);
  const kd = deaths > 0 ? kills / deaths : kills;
  const winRate = matches > 0 ? (wins / matches) * 100 : 0;

  // Determine which mode has the most new matches this session
  const modeDeltas: Record<string, number> = {
    solo:  Math.max(0, current.stats.solo.matches  - baseline.stats.stats.solo.matches),
    duo:   Math.max(0, current.stats.duo.matches   - baseline.stats.stats.duo.matches),
    squad: Math.max(0, current.stats.squad.matches - baseline.stats.stats.squad.matches),
  };
  const topMode = Object.entries(modeDeltas).sort((a, b) => b[1] - a[1])[0];
  const activeMode = (topMode[1] > 0 ? topMode[0] : null) as SessionStats['activeMode'];

  return {
    kills,
    deaths,
    matches,
    wins,
    kd: parseFloat(kd.toFixed(2)),
    winRate: parseFloat(winRate.toFixed(1)),
    startTime,
    activeMode,
  };
}
