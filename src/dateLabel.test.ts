import { describe, it, expect, vi } from 'vitest';
import { formatDateLabel, buildDateLabelSvg, parseDateLabelPayload } from './dateLabel';
import { printDateLabel } from './labelPrinter';
import type { AgentConfig } from './config';

const LA = 'America/Los_Angeles';

describe('formatDateLabel', () => {
  it('weekday/month/day uppercase + h:mm AM/PM in the given timezone', () => {
    // 2026-09-29 is a Tuesday; 22:42Z = 15:42 PDT
    expect(formatDateLabel('2026-09-29T22:42:00Z', LA)).toEqual({ line1: 'TUE SEP 29', line2: '3:42 PM' });
  });
  it('midnight → 12:00 AM', () => {
    expect(formatDateLabel('2026-09-29T07:00:00Z', LA)).toEqual({ line1: 'TUE SEP 29', line2: '12:00 AM' });
  });
  it('noon → 12:00 PM', () => {
    expect(formatDateLabel('2026-09-29T19:00:00Z', LA)).toEqual({ line1: 'TUE SEP 29', line2: '12:00 PM' });
  });
  it('uses local date across the UTC day boundary', () => {
    expect(formatDateLabel('2026-10-01T06:30:00Z', LA)).toEqual({ line1: 'WED SEP 30', line2: '11:30 PM' });
  });
  it('invalid date throws', () => {
    expect(() => formatDateLabel('not-a-date', LA)).toThrow();
  });
});

describe('buildDateLabelSvg', () => {
  const sizes = (svg: string) => [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => parseFloat(m[1]));

  it('contains both lines, width/height, line2 bigger than line1', () => {
    const svg = buildDateLabelSvg('TUE SEP 29', '3:42 PM', { widthPx: 406, heightPx: 203 });
    expect(svg).toContain('width="406"');
    expect(svg).toContain('height="203"');
    expect(svg).toContain('>TUE SEP 29</text>');
    expect(svg).toContain('>3:42 PM</text>');
    const [s1, s2] = sizes(svg);
    expect(s2).toBeGreaterThan(s1);
    expect(svg).toContain('font-weight="bold"');
  });
  it('escapes text', () => {
    const svg = buildDateLabelSvg('A<B&C', '"x"', { widthPx: 406, heightPx: 203 });
    expect(svg).toContain('A&lt;B&amp;C');
    expect(svg).toContain('&quot;x&quot;');
    expect(svg).not.toContain('A<B');
  });
  it('shrinks a line whose estimated width exceeds 94% of width', () => {
    const svg = buildDateLabelSvg('WEDNESDAY SEPTEMBER 30', '12:00 PM', { widthPx: 406, heightPx: 203 });
    const [s1, s2] = sizes(svg);
    expect(22 * 0.6 * s1).toBeLessThanOrEqual(406 * 0.94 + 0.01);
    expect(8 * 0.6 * s2).toBeLessThanOrEqual(406 * 0.94 + 0.01);
  });
});

describe('parseDateLabelPayload (socket guard)', () => {
  const cfg = { labelPrinterName: 'Rollo' } as AgentConfig;
  const ok = { printedAt: '2026-09-29T22:42:00Z', timezone: LA, copies: 2 };
  it('accepts a valid payload', () => {
    expect(parseDateLabelPayload(ok, cfg)).toEqual(ok);
  });
  it('ignores when labelPrinterName is empty', () => {
    expect(parseDateLabelPayload(ok, { labelPrinterName: '' } as AgentConfig)).toBeNull();
  });
  it('ignores invalid payloads', () => {
    expect(parseDateLabelPayload(null, cfg)).toBeNull();
    expect(parseDateLabelPayload({ ...ok, printedAt: 'bad' }, cfg)).toBeNull();
    expect(parseDateLabelPayload({ ...ok, timezone: '' }, cfg)).toBeNull();
    expect(parseDateLabelPayload({ ...ok, timezone: 'Not/AZone' }, cfg)).toBeNull();
    expect(parseDateLabelPayload({ ...ok, copies: 'x' }, cfg)).toBeNull();
  });
});

describe('printDateLabel', () => {
  const config = {
    labelPrinterName: 'Rollo',
    labelWidthIn: 2, labelHeightIn: 1, labelDpi: 203, labelGapMm: 2, labelDensity: 8, fontFamily: '',
  } as AgentConfig;
  const countPrints = (job: Buffer) => (job.toString('latin1').match(/PRINT 1,1/g) ?? []).length;
  const base = { printedAt: '2026-09-29T22:42:00Z', timezone: LA };

  it('copies 3 → one TSPL job with 3 PRINT commands', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const n = await printDateLabel({ ...base, copies: 3 }, config, send);
    expect(n).toBe(3);
    expect(send).toHaveBeenCalledTimes(1);
    const [job, printer] = send.mock.calls[0];
    expect(printer).toBe('Rollo');
    expect(countPrints(job)).toBe(3);
  });
  it('clamps copies 0 → 1 and 50 → 10', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await printDateLabel({ ...base, copies: 0 }, config, send)).toBe(1);
    expect(countPrints(send.mock.calls[0][0])).toBe(1);
    expect(await printDateLabel({ ...base, copies: 50 }, config, send)).toBe(10);
    expect(countPrints(send.mock.calls[1][0])).toBe(10);
  });
});
