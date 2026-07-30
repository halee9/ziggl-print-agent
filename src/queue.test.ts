import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// 렌더·전송은 모킹 — 큐 로직만 검증
vi.mock('./render', () => ({
  renderStarGraphic: vi.fn().mockResolvedValue(Buffer.from('raster')),
}));
vi.mock('./printer', () => ({
  sendToPrinter: vi.fn().mockResolvedValue(undefined),
}));

import { PrintQueue } from './queue';
import { StateStore } from './state';
import { sendToPrinter } from './printer';
import type { KDSOrder } from './types';

const mockedSend = vi.mocked(sendToPrinter);

const ORDER: KDSOrder = {
  id: 'o1', displayId: '7', source: 'Kiosk', status: 'IN_PROGRESS', isDelivery: false,
  displayName: 'T', pickupAt: '', lineItems: [], totalMoney: 100,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

function makeQueue(overrides: Partial<Record<string, any>> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ziggl-queue-test-'));
  const state = new StateStore(dir);
  const deps = {
    config: {
      serverUrl: 'https://x', restaurantCode: 'midori', printerIp: '1.2.3.4', printerPort: 9100,
      cpl: 48, enabled: true, timezoneFallback: 'America/Los_Angeles',
      maxTicketAgeMinutes: 30, logLevel: 'error', dataDir: dir,
    } as any,
    api: { fetchOrder: vi.fn().mockResolvedValue(null) } as any,
    state,
    resolveCached: vi.fn().mockReturnValue(ORDER),
    getTimezone: () => 'America/Los_Angeles',
    getMenu: () => ({ menuItems: [], modifiers: [] }),
    ...overrides,
  };
  const queue = new PrintQueue(deps as any);
  return { queue, state, deps };
}

const flush = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  vi.clearAllMocks();
  mockedSend.mockResolvedValue(undefined);
});

describe('PrintQueue', () => {
  it('prints an enqueued order once and marks it printed', async () => {
    const { queue, state } = makeQueue();
    queue.enqueue('o1', 'auto');
    await flush();
    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(state.isPrinted('o1')).toBe(true);
    // 같은 주문 재enqueue → 무시
    queue.enqueue('o1', 'auto');
    await flush();
    expect(mockedSend).toHaveBeenCalledTimes(1);
    queue.stop();
  });

  it('skips orders already marked printed', async () => {
    const { queue, state } = makeQueue();
    state.markPrinted('o1', 'auto');
    queue.enqueue('o1', 'auto');
    await flush();
    expect(mockedSend).not.toHaveBeenCalled();
    queue.stop();
  });

  it('skips CANCELED orders and marks them', async () => {
    const { queue, state } = makeQueue({
      resolveCached: vi.fn().mockReturnValue({ ...ORDER, status: 'CANCELED' }),
    });
    queue.enqueue('o1', 'auto');
    await flush();
    expect(mockedSend).not.toHaveBeenCalled();
    expect(state.isPrinted('o1')).toBe(true);
    queue.stop();
  });

  it('dropIfUnprinted removes queued job', async () => {
    // 인쇄를 지연시켜 큐에 머물게 함
    mockedSend.mockImplementation(() => new Promise((r) => setTimeout(r, 200)));
    const { queue } = makeQueue();
    queue.enqueue('o1', 'auto');
    queue.enqueue('o2', 'auto');
    queue.dropIfUnprinted('o2');
    await new Promise((r) => setTimeout(r, 400));
    expect(queue.pendingCount).toBe(0);
    expect(mockedSend).toHaveBeenCalledTimes(1); // o1만 인쇄
    queue.stop();
  });

  it('skips unresolvable (cross-restaurant) orders without printing', async () => {
    const { queue, state } = makeQueue({
      resolveCached: vi.fn().mockReturnValue(undefined),
      api: { fetchOrder: vi.fn().mockResolvedValue({ order: ORDER, restaurantCode: 'other-restaurant' }) },
    });
    queue.enqueue('o1', 'auto');
    await flush();
    expect(mockedSend).not.toHaveBeenCalled();
    expect(state.isPrinted('o1')).toBe(false);
    expect(queue.pendingCount).toBe(0);
    queue.stop();
  });

  it('restores pending jobs from persisted state on construction', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ziggl-queue-test-'));
    const state1 = new StateStore(dir);
    state1.setPendingJobs([{ orderId: 'o1', enqueuedAt: new Date().toISOString(), source: 'auto' }]);
    const state2 = new StateStore(dir);
    const queue = new PrintQueue({
      config: { maxTicketAgeMinutes: 30, cpl: 48, serverUrl: 'x', restaurantCode: 'midori', printerIp: '1.2.3.4', printerPort: 9100 } as any,
      api: { fetchOrder: vi.fn() } as any,
      state: state2,
      resolveCached: () => ORDER,
      getTimezone: () => 'America/Los_Angeles',
      getMenu: () => ({ menuItems: [], modifiers: [] }),
    });
    await flush();
    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(state2.isPrinted('o1')).toBe(true);
    queue.stop();
  });

  it('drops jobs older than maxTicketAgeMinutes without printing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ziggl-queue-test-'));
    const state1 = new StateStore(dir);
    state1.setPendingJobs([{ orderId: 'o1', enqueuedAt: new Date(Date.now() - 60 * 60_000).toISOString(), source: 'auto' }]);
    const state2 = new StateStore(dir);
    const queue = new PrintQueue({
      config: { maxTicketAgeMinutes: 30, cpl: 48, serverUrl: 'x', restaurantCode: 'midori', printerIp: '1.2.3.4', printerPort: 9100 } as any,
      api: { fetchOrder: vi.fn() } as any,
      state: state2,
      resolveCached: () => ORDER,
      getTimezone: () => 'America/Los_Angeles',
      getMenu: () => ({ menuItems: [], modifiers: [] }),
    });
    await flush();
    expect(mockedSend).not.toHaveBeenCalled();
    expect(queue.pendingCount).toBe(0);
    queue.stop();
  });
});
