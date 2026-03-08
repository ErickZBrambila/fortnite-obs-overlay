import { fetchPlayerStats } from './fortnite-api';
import { setBaseline, hasBaseline, computeSession } from './stats-tracker';
import type { SquadPlayer } from './config';
import type { SessionStats } from './stats-tracker';

export interface SquadMemberState {
  username: string;
  label: string;
  platform: string;
  battlePass: { level: number; progress: number } | null;
  session: SessionStats | null;
  error: string | null;
  lastUpdated: string | null;
}

export interface SquadState {
  players: SquadMemberState[];
  updatedAt: string;
}

let currentPlayers: SquadPlayer[] = [];
let lastState: SquadState = { players: [], updatedAt: new Date().toISOString() };

export function setSquadPlayers(players: SquadPlayer[]): void {
  currentPlayers = players.filter(p => p.enabled && p.username.trim()).slice(0, 4);
}

export function getSquadState(): SquadState {
  return lastState;
}

export async function pollSquad(apiKey: string): Promise<SquadState> {
  if (currentPlayers.length === 0) {
    lastState = { players: [], updatedAt: new Date().toISOString() };
    return lastState;
  }

  const results = await Promise.allSettled(
    currentPlayers.map(p => fetchPlayerStats(p.username, apiKey))
  );

  const players: SquadMemberState[] = results.map((result, i) => {
    const cfg = currentPlayers[i];

    if (result.status === 'rejected') {
      const message = result.reason instanceof Error ? result.reason.message : 'Failed to load';
      console.error(`[squad] ${cfg.username}: ${message}`);
      return {
        username: cfg.username,
        label:    cfg.label || cfg.username,
        platform: cfg.platform,
        battlePass: null,
        session:    null,
        error:      message,
        lastUpdated: null,
      };
    }

    const stats = result.value;
    const key = cfg.username.toLowerCase();

    if (!hasBaseline(key)) {
      setBaseline(key, stats);
    }

    const session = computeSession(key, stats);
    console.log(`[squad] ${cfg.username} — K:${session.kills} D:${session.deaths} M:${session.matches}`);

    return {
      username:    stats.account.name,
      label:       cfg.label || stats.account.name,
      platform:    cfg.platform,
      battlePass:  stats.battlePass,
      session,
      error:       null,
      lastUpdated: stats.lastUpdated,
    };
  });

  lastState = { players, updatedAt: new Date().toISOString() };
  return lastState;
}
