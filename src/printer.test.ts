import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { sendToPrinter, CONNECT_TIMEOUT_MS } from './printer';

let server: net.Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

function listen(handler: (socket: net.Socket) => void): Promise<number> {
  return new Promise((resolve) => {
    server = net.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve((server!.address() as net.AddressInfo).port);
    });
  });
}

describe('sendToPrinter', () => {
  it('resolves once data is flushed even if the printer never closes the socket (TSP100 behavior)', async () => {
    const received: Buffer[] = [];
    const port = await listen((socket) => {
      socket.on('data', (d) => received.push(d)); // 데이터만 받고 절대 close하지 않음
    });
    await expect(sendToPrinter(Buffer.from('raster-data'), '127.0.0.1', port)).resolves.toBeUndefined();
    expect(Buffer.concat(received).toString()).toBe('raster-data');
  }, 10_000);

  it('rejects when nothing is listening (connection refused)', async () => {
    await expect(sendToPrinter(Buffer.from('x'), '127.0.0.1', 1)).rejects.toThrow();
  }, 10_000);

  // LAN 프린터 연결은 수 ms — 응답 없는 프린터를 오래 기다리면 재시도까지 티켓이 수 초 늦어짐
  // (2026-10-28/29 매장: 5s 타임아웃 + 2s 대기로 티켓 ~8초 지연)
  it('uses a short connect timeout suitable for a LAN printer', () => {
    expect(CONNECT_TIMEOUT_MS).toBeLessThanOrEqual(2_000);
  });
});
