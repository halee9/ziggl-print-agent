import net from 'node:net';
import { log } from './log';

const CONNECT_TIMEOUT_MS = 5_000;
const SEND_TIMEOUT_MS = 20_000;
/** 데이터 플러시 후 소켓 정리까지의 여유 */
const CLOSE_GRACE_MS = 500;

/**
 * TCP 9100으로 래스터 버퍼 전송.
 * 성공 기준 = 연결 성공 + 버퍼 전체 플러시. **상대방의 소켓 close를 기다리지 않음** —
 * TSP100은 인쇄 중 소켓을 닫지 않는 경우가 있어, close를 기다리면 이미 인쇄된 잡을
 * 실패로 오판해 재시도 → 같은 티켓이 반복 출력되는 사고가 남.
 * (ASB back-channel은 v1 스킵 — 용지 없음은 감지 못함)
 */
export function sendToPrinter(buffer: Buffer, ip: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    const overall = setTimeout(() => finish(new Error(`send timeout after ${SEND_TIMEOUT_MS}ms`)), SEND_TIMEOUT_MS);
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => finish(new Error(`connect timeout to ${ip}:${port}`)));
    socket.on('error', (err) => { clearTimeout(overall); finish(err); });

    socket.connect(port, ip, () => {
      socket.setTimeout(0); // 연결됐으니 connect 타임아웃 해제 (전체 타임아웃은 유지)
      log.debug(`printer connected ${ip}:${port}, sending ${buffer.length} bytes`);
      socket.end(buffer, () => {
        // 버퍼가 커널로 플러시됨 — 프린터가 데이터를 수신하는 중이거나 이미 인쇄 중.
        // 잠깐의 여유 후 성공 처리 (마지막 패킷 전송 여유)
        setTimeout(() => { clearTimeout(overall); finish(); }, CLOSE_GRACE_MS);
      });
    });
  });
}
