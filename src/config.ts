import fs from 'node:fs';
import path from 'node:path';

export interface AgentConfig {
  serverUrl: string;
  restaurantCode: string;
  printerIp: string;
  printerPort: number;
  cpl: number;
  enabled: boolean;
  timezoneFallback: string;
  maxTicketAgeMinutes: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** data 디렉토리 (state.json, logs/) — 기본: config.json 옆 data/ */
  dataDir: string;
}

const DEFAULTS = {
  printerPort: 9100,
  cpl: 48,
  enabled: true,
  timezoneFallback: 'America/Los_Angeles',
  maxTicketAgeMinutes: 30,
  logLevel: 'info' as const,
};

export function loadConfig(): AgentConfig {
  const configPath = process.env.ZIGGL_AGENT_CONFIG || path.join(process.cwd(), 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`config.json not found at ${configPath} — copy config.example.json and fill in`);
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  for (const key of ['serverUrl', 'restaurantCode', 'printerIp'] as const) {
    if (!raw[key] || typeof raw[key] !== 'string') {
      throw new Error(`config.json: "${key}" is required (string)`);
    }
  }

  const config: AgentConfig = {
    serverUrl: raw.serverUrl.replace(/\/$/, ''),
    restaurantCode: raw.restaurantCode.toLowerCase(),
    printerIp: raw.printerIp,
    printerPort: raw.printerPort ?? DEFAULTS.printerPort,
    cpl: raw.cpl ?? DEFAULTS.cpl,
    enabled: raw.enabled ?? DEFAULTS.enabled,
    timezoneFallback: raw.timezoneFallback ?? DEFAULTS.timezoneFallback,
    maxTicketAgeMinutes: raw.maxTicketAgeMinutes ?? DEFAULTS.maxTicketAgeMinutes,
    logLevel: raw.logLevel ?? DEFAULTS.logLevel,
    dataDir: raw.dataDir ?? path.join(path.dirname(configPath), 'data'),
  };

  if (!Number.isInteger(config.printerPort) || config.printerPort < 1 || config.printerPort > 65535) {
    throw new Error('config.json: printerPort must be 1-65535');
  }
  if (!Number.isInteger(config.cpl) || config.cpl < 24 || config.cpl > 96) {
    throw new Error('config.json: cpl must be 24-96 (48 for 80mm)');
  }
  return config;
}
