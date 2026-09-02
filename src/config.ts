import fs from 'node:fs';
import path from 'node:path';

export interface AgentConfig {
  serverUrl: string;
  restaurantCode: string;
  /** 서버 인증용 staff API 키 (zgl_...). 서버 AUTH_ENFORCE 전엔 비어 있어도 동작 */
  apiKey?: string;
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
  /** 아이템 레이블 프린터의 Windows 프린터 이름 (예: "Rollo Printer").
   *  빈 값이면 레이블 기능 비활성 — labeler room에 join하지 않아 POS가 브라우저 인쇄로 폴백 */
  labelPrinterName: string;
  /** POS "Print Items" 릴레이 수신 여부. 매장 본기기만 true —
   *  집에서 Rollo 테스트할 땐 false로 두어야 매장 레이블 출력을 가로채지 않음
   *  (npm run test-label은 이 플래그와 무관하게 동작) */
  acceptLabelPrints: boolean;
  labelWidthIn: number;   // 레이블 폭 (인치)
  labelHeightIn: number;  // 레이블 높이 (인치)
  labelDpi: number;       // Rollo = 203
  labelGapMm: number;     // 라벨 사이 갭 (셀프테스트 GAP LEN 값)
  labelDensity: number;   // TSPL 인쇄 농도 0-15
  enabled: boolean;
  timezoneFallback: string;
  maxTicketAgeMinutes: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** data 디렉토리 (state.json, logs/) — 기본: config.json 옆 data/ */
  dataDir: string;
  /** 시리얼(COM) 스캐너 포트 (예: "COM3"). 빈 값이면 스캐너 비활성.
   *  스캐너를 USB Virtual COM 모드로 설정하면 포커스와 무관하게 스캔 처리됨 */
  scanPort: string;
  /** 시리얼 보드레이트 (Netum USB-COM 기본 9600) */
  scanBaud: number;
  /** 티켓 스캔 시 전환할 상태: 'complete'=캐시어→COMPLETED, 'ready'=주방→READY */
  scanStation: 'ready' | 'complete';
}

const DEFAULTS = {
  printerPort: 9100,
  cpl: 30,
  threshold: 200,
  fontFamily: '',
  acceptManualPrints: true,
  labelPrinterName: '',
  acceptLabelPrints: true,
  labelWidthIn: 2,
  labelHeightIn: 1,
  labelDpi: 203,
  labelGapMm: 2,
  labelDensity: 8,
  enabled: true,
  timezoneFallback: 'America/Los_Angeles',
  maxTicketAgeMinutes: 30,
  logLevel: 'info' as const,
  scanPort: '',
  scanBaud: 9600,
  scanStation: 'complete' as const,
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
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '',
    printerIp: raw.printerIp,
    printerPort: raw.printerPort ?? DEFAULTS.printerPort,
    cpl: raw.cpl ?? DEFAULTS.cpl,
    threshold: raw.threshold ?? DEFAULTS.threshold,
    fontFamily: raw.fontFamily ?? DEFAULTS.fontFamily,
    acceptManualPrints: raw.acceptManualPrints ?? DEFAULTS.acceptManualPrints,
    labelPrinterName: raw.labelPrinterName ?? DEFAULTS.labelPrinterName,
    acceptLabelPrints: raw.acceptLabelPrints ?? DEFAULTS.acceptLabelPrints,
    labelWidthIn: raw.labelWidthIn ?? DEFAULTS.labelWidthIn,
    labelHeightIn: raw.labelHeightIn ?? DEFAULTS.labelHeightIn,
    labelDpi: raw.labelDpi ?? DEFAULTS.labelDpi,
    labelGapMm: raw.labelGapMm ?? DEFAULTS.labelGapMm,
    labelDensity: raw.labelDensity ?? DEFAULTS.labelDensity,
    enabled: raw.enabled ?? DEFAULTS.enabled,
    timezoneFallback: raw.timezoneFallback ?? DEFAULTS.timezoneFallback,
    maxTicketAgeMinutes: raw.maxTicketAgeMinutes ?? DEFAULTS.maxTicketAgeMinutes,
    logLevel: raw.logLevel ?? DEFAULTS.logLevel,
    dataDir: raw.dataDir ?? path.join(path.dirname(configPath), 'data'),
    scanPort: raw.scanPort ?? DEFAULTS.scanPort,
    scanBaud: raw.scanBaud ?? DEFAULTS.scanBaud,
    scanStation: raw.scanStation === 'ready' ? 'ready' : DEFAULTS.scanStation,
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
