import net from 'node:net';
import { log } from './log';

const CONNECT_TIMEOUT_MS = 5_000;
const SEND_TIMEOUT_MS = 20_000;

/**
 * TCP 9100으로 래스터 버퍼 전송.
 * 연결 성공 + 전체 write + 정상 close = 성공으로 간주 (ASB back-channel은 v1 스킵 —
 * 용지 없음은 감지 못함; README의 일일 테스트 + POS 수동 폴백으로 보완).
 */
export function sendToPrinter(buffer: Buffer, ip: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };

    const overall = setTimeout(() => fail(new Error(`send timeout after ${SEND_TIMEOUT_MS}ms`)), SEND_TIMEOUT_MS);
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => fail(new Error(`connect timeout to ${ip}:${port}`)));
    socket.on('error', (err) => fail(err));
    socket.on('close', (hadError) => {
      clearTimeout(overall);
      if (settled) return;
      settled = true;
      if (hadError) reject(new Error('socket closed with error'));
      else resolve();
    });

    socket.connect(port, ip, () => {
      socket.setTimeout(0); // 연결됐으니 connect 타임아웃 해제 (전체 타임아웃은 유지)
      log.debug(`printer connected ${ip}:${port}, sending ${buffer.length} bytes`);
      socket.end(buffer); // write + FIN
    });
  });
}
