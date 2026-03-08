const BASE_URL = 'https://fortnite-api.com/v2';

export interface ModeStats {
  wins: number;
  kills: number;
  kd: number;
  matches: number;
  winRate: number;
  killsPerMatch: number;
  minutesPlayed: number;
  deaths: number;
  score: number;
  scorePerMatch: number;
  top3?: number;
  top5?: number;
  top10?: number;
  top25?: number;
}

export interface PlayerStats {
  account: {
    id: string;
    name: string;
  };
  battlePass: {
    level: number;
    progress: number;
  };
  stats: {
    overall: ModeStats;
    solo: ModeStats;
    duo: ModeStats;
    squad: ModeStats;
  };
  lastUpdated: string;
}

function mapMode(raw: Record<string, number> | undefined): ModeStats {
  return {
    wins: raw?.wins ?? 0,
    kills: raw?.kills ?? 0,
    kd: raw?.kd ?? 0,
    matches: raw?.matches ?? 0,
    winRate: raw?.winRate ?? 0,
    killsPerMatch: raw?.killsPerMatch ?? 0,
    minutesPlayed: raw?.minutesPlayed ?? 0,
    deaths: raw?.deaths ?? 0,
    score: raw?.score ?? 0,
    scorePerMatch: raw?.scorePerMatch ?? 0,
    top3: raw?.top3,
    top5: raw?.top5,
    top10: raw?.top10,
    top25: raw?.top25,
  };
}

export async function fetchPlayerStats(username: string, apiKey: string): Promise<PlayerStats> {
  const url = `${BASE_URL}/stats/br/v2?name=${encodeURIComponent(username)}`;

  const response = await fetch(url, {
    headers: { Authorization: apiKey },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Invalid or missing API key. Check your FORTNITE_API_KEY in .env');
    }
    if (response.status === 404) {
      throw new Error(`Player "${username}" not found. Check the Epic username and try again.`);
    }
    throw new Error(`Fortnite API error: HTTP ${response.status}`);
  }

  const json = await response.json() as { data: Record<string, unknown> };
  const data = json.data as Record<string, unknown>;
  const allStats = (data.stats as Record<string, unknown>)?.all as Record<string, Record<string, number>>;

  return {
    account: {
      id: (data.account as Record<string, string>)?.id ?? '',
      name: (data.account as Record<string, string>)?.name ?? username,
    },
    battlePass: {
      level: (data.battlePass as Record<string, number>)?.level ?? 0,
      progress: (data.battlePass as Record<string, number>)?.progress ?? 0,
    },
    stats: {
      overall: mapMode(allStats?.overall),
      solo: mapMode(allStats?.solo),
      duo: mapMode(allStats?.duo),
      squad: mapMode(allStats?.squad),
    },
    lastUpdated: allStats?.overall?.lastModified
      ? new Date(allStats.overall.lastModified).toISOString()
      : new Date().toISOString(),
  };
}
