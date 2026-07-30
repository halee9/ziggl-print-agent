import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildTicketDoc, esc, formatMoney, normalizeMod } from './ticket';
import type { KDSOrder } from './types';
import type { TicketOptions as TO } from './ticket';

const fixture: KDSOrder = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/sample-order.json'), 'utf-8')
);

const baseOpts: TO = {
  timezone: 'America/Los_Angeles',
  serverUrl: 'https://api.ziggl.app',
  menu: {
    menuItems: [{ item_name: 'Garlic Spicy Combo', abbreviation: 'GS Combo', server_alert: true }],
    modifiers: [{ modifier_name: 'Extra Spicy Sauce', abbreviation: 'Ex Spicy', server_alert: true }],
  },
  printSource: 'test',
  now: new Date('2026-07-29T18:27:00Z'),
};

describe('esc', () => {
  it('escapes receiptline special characters', () => {
    expect(esc('a|b{c}d^e_f"g`h~i-j\\k')).toBe('a\\|b\\{c\\}d\\^e\\_f\\"g\\`h\\~i\\-j\\\\k');
  });
});

describe('formatDisplayName', () => {
  it('keeps first name, initials the last name', async () => {
    const { formatDisplayName } = await import('./ticket');
    expect(formatDisplayName('William Chong')).toBe('William C.');
    expect(formatDisplayName('Mary Jane Watson')).toBe('Mary Jane W.');
    expect(formatDisplayName('Jason')).toBe('Jason');
    expect(formatDisplayName('  ')).toBe('-');
    expect(formatDisplayName('kim lee')).toBe('kim L.');
  });
});

describe('normalizeMod', () => {
  it('string → {name, qty:1, price:0}', () => {
    expect(normalizeMod('Miso Soup')).toEqual({ name: 'Miso Soup', qty: 1, price: 0 });
  });
  it('object passthrough with quantity fallback', () => {
    expect(normalizeMod({ name: 'X', quantity: 3, price: 50 })).toEqual({ name: 'X', qty: 3, price: 50 });
  });
});

describe('buildTicketDoc', () => {
  const doc = buildTicketDoc(fixture, baseOpts);
  const lines = doc.split('\n');

  it('renders header: source+pickup, name, order time', () => {
    expect(lines[0]).toBe('|Kiosk Pickup|');
    expect(lines[1]).toBe('|^^^"Jason"|'); // ^^^ = 가로세로 2배 (^^는 반폭)
    expect(doc).toContain('|Order at 7/29/2026, 11:05 AM|');
  });

  it('omits Pickup at when pickupAt empty; renders when present', () => {
    expect(doc).not.toContain('Pickup at');
    const withPickup = buildTicketDoc({ ...fixture, pickupAt: '2026-07-30T01:30:00Z' }, baseOpts);
    expect(withPickup).toContain('|Pickup at 7/29/2026, 6:30 PM|');
  });

  it('renders zero-padded displayId at max scale, bag count, and QR', () => {
    expect(doc).toContain('|^^^^^"042"|'); // 3자리 zero padding + 4배 확대
    expect(doc).toContain('|2 Bags|');
    expect(doc).toContain('{code:https://api.ziggl.app/receipt/TEST-ORDER-0001; option:qrcode,4,l}');
  });

  it('renders line items: qty prefix, bold name+price, variation, modifiers, escaped note', () => {
    expect(doc).toContain('"2 Chicken Teriyaki" | "$33.98"');
    expect(doc).toContain('Large |');
    expect(doc).toContain('Brown Rice | $1.00');
    expect(doc).toContain('2x Extra Spicy Sauce | $1.50'); // price × qty
    expect(doc).toContain("'no onions \\| extra \\{sauce\\} please'"); // 특수문자 이스케이프
    expect(doc).toContain('"Garlic Spicy Combo" | "$21.08"'); // qty 1 → prefix 없음
    expect(doc).toContain('Miso Soup | '); // string modifier, 가격 없음
  });

  it('renders totals with discount and scaled Total', () => {
    expect(doc).toContain('Subtotal | $57.56');
    expect(doc).toContain('Tax | $6.05');
    expect(doc).toContain('Bag Fee | $0.20');
    expect(doc).toContain('Points Discount | \\-$3.00');
    expect(doc).toContain('Tip | $5.00');
    expect(doc).toContain('"Total" | "$65.81"'); // 별도 세그먼트(큰 밀도)에서 bold로 렌더
  });

  it('renders card payment; cash renders as Cash', () => {
    expect(doc).toContain('|VISA **** 8820|');
    const cash = buildTicketDoc({ ...fixture, paymentMethod: 'CASH' }, baseOpts);
    expect(cash).toContain('|Cash|');
    expect(cash).not.toContain('VISA');
  });

  it('aggregates server alerts with abbreviations: modifier qty × item qty', () => {
    expect(doc).toContain('"!! CONFIRM:" |');
    expect(doc).toContain('"4 Ex Spicy" |'); // 2(mod qty) × 2(item qty)
    expect(doc).toContain('"1 GS Combo" |');
  });

  it('omits CONFIRM block when no alerts configured', () => {
    const noAlerts = buildTicketDoc(fixture, { ...baseOpts, menu: { menuItems: [], modifiers: [] } });
    expect(noAlerts).not.toContain('CONFIRM');
  });

  it('renders NOTE; renders DELIVERY when present', () => {
    expect(doc).toContain('"NOTE: customer will arrive at 6:30" |');
    expect(doc).not.toContain('DELIVERY:');
    const delivery = buildTicketDoc({ ...fixture, deliveryNote: 'PIN 1234, apt 5' }, baseOpts);
    expect(delivery).toContain('"DELIVERY: PIN 1234, apt 5" |');
  });

  it('renders provenance footer with restaurant-tz time and source', () => {
    expect(doc).toContain('|Printed at 11:27 AM \\- test|');
  });

  it('never renders customerPhone (screen-only field)', () => {
    const withPhone = buildTicketDoc({ ...fixture, customerPhone: '(206) 555-4567' } as any, baseOpts);
    expect(withPhone).not.toContain('555-4567');
  });
});

describe('formatMoney', () => {
  it('formats cents to $X.XX', () => {
    expect(formatMoney(6581)).toBe('$65.81');
    expect(formatMoney(0)).toBe('$0.00');
  });
});
