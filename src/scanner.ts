import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import type { AgentConfig } from './config';
import type { Api } from './api';
import { log } from './log';

/**
 * 시리얼(COM) 바코드 스캐너 처리.
 * 스캐너를 USB Virtual COM 모드로 두면 키보드 입력이 아니라 COM 포트로 데이터가 오므로
 * 브라우저 창 포커스와 무관하게 스캔이 동작한다(캐시어 멀티 창 포커스 문제 해결).
 *
 * scripts/scan-read.ps1(PowerShell SerialPort 리더)을 자식 프로세스로 띄우고,
 * stdout 라인 1건 = 스캔 1건으로 받아 티켓이면 서버에 상태 전환을 요청한다.
 * 네이티브 serialport 모듈 대신 PowerShell을 쓰는 이유: 매장 PC에서 네이티브 빌드/바이너리
 * 호환 리스크 회피(기존 raw 프린트도 같은 PowerShell spawn 패턴).
 */
export class Scanner {
  private child: ChildProcess | null = null;
  private stopped = false;
  private lastCode = '';
  private lastAt = 0;

  constructor(private config: AgentConfig, private api: Api) {}

  start(): void {
    if (!this.config.scanPort) return;
    this.spawnReader();
    log.info(
      `scanner: listening on ${this.config.scanPort} @ ${this.config.scanBaud} (station=${this.config.scanStation})`,
    );
  }

  stop(): void {
    this.stopped = true;
    if (this.child) {
      try { this.child.kill(); } catch { /* ignore */ }
      this.child = null;
    }
  }

  private spawnReader(): void {
    if (this.stopped) return;
    const script = path.join(__dirname, '../scripts/scan-read.ps1');
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Port', this.config.scanPort, '-Baud', String(this.config.scanBaud)],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.child = child;

    const rl = readline.createInterface({ input: child.stdout! });
    rl.on('line', (line) => this.onScan(line.trim()));

    child.stderr?.on('data', (d) => {
      const msg = String(d).trim();
      if (msg) log.debug(`scan-read: ${msg}`);
    });

    child.on('exit', (code) => {
      this.child = null;
      if (this.stopped) return;
      log.warn(`scanner reader exited (code=${code}) — restarting in 3s`);
      setTimeout(() => this.spawnReader(), 3000);
    });
  }

  private async onScan(code: string): Promise<void> {
    if (!code) return;

    // 자동감지/연타 스캐너의 동일 코드 중복 무시 (2.5s 쿨다운)
    const now = Date.now();
    if (code === this.lastCode && now - this.lastAt < 2500) {
      this.lastAt = now;
      return;
    }
    this.lastCode = code;
    this.lastAt = now;

    const orderId = parseTicket(code);
    if (!orderId) {
      // 티켓 QR(영수증 URL)이 아니면 무시 — 아이템 레이블(zgi:)은 주방 브라우저에서 처리
      log.debug(`scan ignored (not a ticket): ${code.slice(0, 40)}`);
      return;
    }

    const status = this.config.scanStation === 'ready' ? 'READY' : 'COMPLETED';
    try {
      const httpStatus = await this.api.advanceStatus(orderId, status);
      if (httpStatus >= 200 && httpStatus < 300) {
        log.info(`scan → ${status} (${orderId})`);
        void this.api.logScan(this.config.scanStation, 'ticket', orderId);
      } else if (httpStatus === 409) {
        log.info(`scan → ${status} rejected (stale/backward) for ${orderId}`);
      } else {
        log.warn(`scan → ${status} failed (HTTP ${httpStatus}) for ${orderId}`);
      }
    } catch (err: any) {
      log.warn(`scan status update failed for ${orderId}: ${err.message}`);
    }
  }
}

/** 티켓 QR(영수증 URL) → orderId. 티켓이 아니면 null. */
export function parseTicket(code: string): string | null {
  const m = code.match(/\/receipt\/([A-Za-z0-9_-]+)\s*$/);
  return m ? m[1] : null;
}
