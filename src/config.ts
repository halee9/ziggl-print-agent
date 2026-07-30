import fs from 'node:fs';
import path from 'node:path';

export interface AgentConfig {
  serverUrl: string;
  restaurantCode: string;
  printerIp: string;
  printerPort: number;
  /** 글자 밀도(줄당 글자수). 용지 폭(48)보다 작을수록 글자가 커짐. 권장 32-42 */
  cpl: number;
  /** 이진화 임계값(100-255). 높을수록 연한 획까지 검정으로 — 흐리면 올릴 것 */
  threshold: number;
  /** 티켓 폰트 (머신에 설치된 폰트명, 예: "Consolas"). 빈 값 = receiptline 기본(Courier 계열).
   *  컬럼 정렬이 monospace 기준이라 고정폭 폰트 권장 */
  fontFamily: string;
  /** POS 수동 재출력(프린터 아이콘) 수신 여부. 매장 본기기만 true —
   *  집/테스트 에이전트는 false로 두어야 매장 재출력을 가로채지 않음 */
  acceptManualPrints: boolean;
  enabled: boolean;
  timezoneFallback: string;
  maxTicketAgeMinutes: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** data 디렉토리 (state.json, logs/) — 기본: config.json 옆 data/ */
  dataDir: string;
}

const DEFAULTS = {
  printerPort: 9100,
  cpl: 30,
  threshold: 200,
  fontFamily: '',
  acceptManualPrints: true,
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
    threshold: raw.threshold ?? DEFAULTS.threshold,
    fontFamily: raw.fontFamily ?? DEFAULTS.fontFamily,
    acceptManualPrints: raw.acceptManualPrints ?? DEFAULTS.acceptManualPrints,
    enabled: raw.enabled ?? DEFAULTS.enabled,
    timezoneFallback: raw.timezoneFallback ?? DEFAULTS.timezoneFallback,
    maxTicketAgeMinutes: raw.maxTicketAgeMinutes ?? DEFAULTS.maxTicketAgeMinutes,
    logLevel: raw.logLevel ?? DEFAULTS.logLevel,
    dataDir: raw.dataDir ?? path.join(path.dirname(configPath), 'data'),
  };

  if (!Number.isInteger(config.printerPort) || config.printerPort < 1 || config.printerPort > 65535) {
    throw new Error('config.json: printerPort must be 1-65535');
  }
  if (!Number.isInteger(config.cpl) || config.cpl < 24 || config.cpl > 48) {
    throw new Error('config.json: cpl must be 24-48 (smaller = bigger text, 36 recommended)');
  }
  if (!Number.isInteger(config.threshold) || config.threshold < 100 || config.threshold > 255) {
    throw new Error('config.json: threshold must be 100-255');
  }
  return config;
}
