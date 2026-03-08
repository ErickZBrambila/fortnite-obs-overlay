import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';

config();

export interface SquadPlayer {
  username: string;
  label: string;
  platform: 'pc' | 'ps5' | 'xbox' | 'switch' | 'mobile';
  enabled: boolean;
}

export interface AppConfig {
  port: number;
  apiKey: string;
  pollIntervalMs: number;
  defaultUsername: string;
  activeTheme: string;
  squadPlayers: SquadPlayer[];
  logFilePath: string;
}

const CONFIG_FILE = path.join(process.cwd(), 'config.json');

function loadSaved(): Partial<Omit<AppConfig, 'port'>> {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as Partial<Omit<AppConfig, 'port'>>;
  } catch {
    return {};
  }
}

const envDefaults: AppConfig = {
  port:            parseInt(process.env.PORT || '3000'),
  apiKey:          process.env.FORTNITE_API_KEY || '',
  pollIntervalMs:  parseInt(process.env.POLL_INTERVAL_MS || '30000'),
  defaultUsername: process.env.DEFAULT_USERNAME || '',
  activeTheme:     process.env.FORTNITE_THEME || 'fortnite',
  squadPlayers:    [],
  logFilePath:     process.env.FORTNITE_LOG_PATH || '',
};

export const RuntimeConfig: AppConfig = {
  ...envDefaults,
  ...loadSaved(),
  port: envDefaults.port,
};

export function saveConfig(): void {
  const { apiKey, pollIntervalMs, defaultUsername, activeTheme, squadPlayers, logFilePath } = RuntimeConfig;
  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify({ apiKey, pollIntervalMs, defaultUsername, activeTheme, squadPlayers, logFilePath }, null, 2),
    'utf-8'
  );
}
