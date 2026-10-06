import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// socket.io-client 최소 모킹 — 네트워크 없이 SocketBridge 생성
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({ on: vi.fn(), emit: vi.fn(), disconnect: vi.fn(), id: 'sock' })),
}));
vi.mock('./labelPrinter', () => ({ printOrderLabels: vi.fn(), printDateLabel: vi.fn() }));

import { SocketBridge } from './socket';
import type { MenuDisplayConfig } from './types';

const GOOD: MenuDisplayConfig = {
  menuItems: [{ name: 'Teriyaki', abbreviation: 'TERI', serverAlert: true } as any],
  modifiers: [{ name: 'Extra Sauce', abbreviation: 'XS' } as any],
};
const GOOD2: MenuDisplayConfig = {
  menuItems: [{ name: 'Bulgogi', abbreviation: 'BUL', serverAlert: true } as any],
  modifiers: [],
};
const EMPTY: MenuDisplayConfig = { menuItems: [], modifiers: [] };

function makeBridge(fetchMenuDisplay: ReturnType<typeof vi.fn>) {
  const api = {
    fetchTimezone: vi.fn().mockResolvedValue('America/Los_Angeles'),
    fetchMenuDisplay,
    fetchActiveOrders: vi.fn().mockResolvedValue([]),
    fetchOrder: vi.fn().mockResolvedValue(null),
  } as any;
  const config = { serverUrl: 'https://x', restaurantCode: 'midori', timezoneFallback: 'America/Los_Angeles' } as any;
  const bridge = new SocketBridge(config, api, {} as any, {} as any);
  return { bridge, api };
}

const refresh = (b: SocketBridge) => (b as any).refreshMenu() as Promise<void>;

describe('SocketBridge menu-display refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('start(): loads config on success', async () => {
    const { bridge } = makeBridge(vi.fn().mockResolvedValue(GOOD));
    await bridge.start();
    expect(bridge.getMenu()).toEqual(GOOD);
    bridge.stop();
  });

  it('refresh failure (null) keeps previous config, retries after 60 s and replaces it', async () => {
    const fetchMenu = vi.fn().mockResolvedValueOnce(GOOD).mockResolvedValueOnce(null).mockResolvedValueOnce(GOOD2);
    const { bridge } = makeBridge(fetchMenu);
    await bridge.start();
    await refresh(bridge);
    expect(bridge.getMenu()).toEqual(GOOD);
    expect(fetchMenu).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetchMenu).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMenu).toHaveBeenCalledTimes(3);
    expect(bridge.getMenu()).toEqual(GOOD2);
    bridge.stop();
  });

  it('repeated failures do not pile up retries', async () => {
    const fetchMenu = vi.fn().mockResolvedValueOnce(GOOD).mockResolvedValue(null);
    const { bridge } = makeBridge(fetchMenu);
    await bridge.start();
    await refresh(bridge);
    await refresh(bridge);
    await refresh(bridge);
    expect(fetchMenu).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_000);
    // 3번 실패했어도 재시도는 1회만
    expect(fetchMenu).toHaveBeenCalledTimes(5);
    expect(bridge.getMenu()).toEqual(GOOD);
    bridge.stop();
  });

  it('empty response after non-empty config is treated as suspicious: keeps previous', async () => {
    const fetchMenu = vi.fn().mockResolvedValueOnce(GOOD).mockResolvedValueOnce(EMPTY);
    const { bridge } = makeBridge(fetchMenu);
    await bridge.start();
    await refresh(bridge);
    expect(bridge.getMenu()).toEqual(GOOD);
    bridge.stop();
  });

  it('empty response accepted when previous config was also empty', async () => {
    const fetchMenu = vi.fn().mockResolvedValue(EMPTY);
    const { bridge } = makeBridge(fetchMenu);
    await bridge.start();
    await refresh(bridge);
    expect(bridge.getMenu()).toEqual(EMPTY);
    bridge.stop();
  });

  it('initial load failure: falls back to empty config and retries after 60 s', async () => {
    const fetchMenu = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(GOOD);
    const { bridge } = makeBridge(fetchMenu);
    await bridge.start();
    expect(bridge.getMenu()).toEqual(EMPTY);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMenu).toHaveBeenCalledTimes(2);
    expect(bridge.getMenu()).toEqual(GOOD);
    bridge.stop();
  });

  it('stop() clears the pending retry', async () => {
    const fetchMenu = vi.fn().mockResolvedValueOnce(GOOD).mockResolvedValueOnce(null).mockResolvedValue(GOOD2);
    const { bridge } = makeBridge(fetchMenu);
    await bridge.start();
    await refresh(bridge);
    bridge.stop();
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(fetchMenu).toHaveBeenCalledTimes(2);
    expect(bridge.getMenu()).toEqual(GOOD);
  });

  it('10-minute tick refreshes the config', async () => {
    const fetchMenu = vi.fn().mockResolvedValueOnce(GOOD).mockResolvedValue(GOOD2);
    const { bridge } = makeBridge(fetchMenu);
    await bridge.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(bridge.getMenu()).toEqual(GOOD2);
    bridge.stop();
  });
});
