import fs from 'node:fs';
import path from 'node:path';

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const RETENTION_DAYS = 14;

let minLevel: Level = 'info';
let logDir = '';

export function initLog(dataDir: string, level: Level) {
  minLevel = level;
  logDir = path.join(dataDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  // 14일 초과 로그 삭제
  const cutoff = Date.now() - RETENTION_DAYS * 86400_000;
  for (const f of fs.readdirSync(logDir)) {
    try {
      const p = path.join(logDir, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    } catch { /* 삭제 실패 무시 */ }
  }
}

function write(level: Level, msg: string) {
  if (LEVELS[level] < LEVELS[minLevel]) return;
  const now = new Date();
  const line = `${now.toISOString()} [${level.toUpperCase()}] ${msg}`;
  // eslint-disable-next-line no-console
  console.log(line);
  if (logDir) {
    const file = path.join(logDir, `agent-${now.toISOString().slice(0, 10)}.log`);
    try { fs.appendFileSync(file, line + '\n'); } catch { /* 디스크 오류 시 콘솔만 */ }
  }
}

export const log = {
  debug: (msg: string) => write('debug', msg),
  info: (msg: string) => write('info', msg),
  warn: (msg: string) => write('warn', msg),
  error: (msg: string) => write('error', msg),
};
