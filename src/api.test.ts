import { describe, it, expect, vi, afterEach } from 'vitest';
import { Api } from './api';

const config = {
  serverUrl: 'https://x', restaurantCode: 'midori', timezoneFallback: 'America/Los_Angeles',
} as any;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Api.fetchMenuDisplay', () => {
  it('returns null when fetch throws (e.g. timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('The operation was aborted due to timeout')));
    expect(await new Api(config).fetchMenuDisplay()).toBeNull();
  });

  it('returns null on non-OK HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }));
    expect(await new Api(config).fetchMenuDisplay()).toBeNull();
  });

  it('returns the config on success', async () => {
    const menuItems = [{ name: 'Teriyaki', abbreviation: 'TERI' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ menuItems }) }));
    expect(await new Api(config).fetchMenuDisplay()).toEqual({ menuItems, modifiers: [] });
  });

  it('uses a GET timeout of at least 8 s', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
    await new Api(config).fetchMenuDisplay();
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toBeGreaterThanOrEqual(8_000);
    spy.mockRestore();
  });
});
