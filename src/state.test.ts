import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StateStore } from './state';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ziggl-agent-test-'));
});

describe('StateStore', () => {
  it('starts uninitialized with empty state on first run', () => {
    const s = new StateStore(dir);
    expect(s.state.initialized).toBe(false);
    expect(s.state.printedIds).toEqual({});
    expect(s.state.pendingJobs).toEqual([]);
  });

  it('persists and reloads printed ids and initialized flag', () => {
    const s1 = new StateStore(dir);
    s1.markPrinted('order-1', 'auto');
    s1.setInitialized();
    const s2 = new StateStore(dir);
    expect(s2.state.initialized).toBe(true);
    expect(s2.isPrinted('order-1')).toBe(true);
    expect(s2.isPrinted('order-2')).toBe(false);
  });

  it('treats corrupted state file as first run (init guard will mark, not print)', () => {
    fs.writeFileSync(path.join(dir, 'state.json'), '{corrupted!!');
    const s = new StateStore(dir);
    expect(s.state.initialized).toBe(false);
  });

  it('prunes printed ids older than 3 days on load', () => {
    const s1 = new StateStore(dir);
    const old = new Date(Date.now() - 4 * 86400_000).toISOString();
    s1.state.printedIds['old-order'] = old + '|auto';
    s1.state.printedIds['new-order'] = new Date().toISOString();
    s1.persist();
    const s2 = new StateStore(dir);
    expect(s2.isPrinted('old-order')).toBe(false);
    expect(s2.isPrinted('new-order')).toBe(true);
  });

  it('persists pending jobs', () => {
    const s1 = new StateStore(dir);
    s1.setPendingJobs([{ orderId: 'o1', enqueuedAt: new Date().toISOString(), source: 'auto' }]);
    const s2 = new StateStore(dir);
    expect(s2.state.pendingJobs).toHaveLength(1);
    expect(s2.state.pendingJobs[0].orderId).toBe('o1');
  });
});
