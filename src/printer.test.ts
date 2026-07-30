import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { sendToPrinter } from './printer';

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
});
