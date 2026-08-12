import { describe, it, expect } from 'vitest';
import { parseTicket } from './scanner';

describe('parseTicket', () => {
  it('extracts orderId from a receipt URL (ticket QR)', () => {
    expect(parseTicket('https://api.ziggl.app/receipt/141350cd-f417-4e54-86cd-56ae868ad53c'))
      .toBe('141350cd-f417-4e54-86cd-56ae868ad53c');
  });

  it('tolerates a trailing CR/whitespace from the serial line', () => {
    expect(parseTicket('https://api.ziggl.app/receipt/ord_9f8e7d\r')).toBe('ord_9f8e7d');
    expect(parseTicket('https://api.ziggl.app/receipt/ord123  ')).toBe('ord123');
  });

  it('returns null for item-label payloads (handled in the kitchen browser)', () => {
    expect(parseTicket('zgi:141350cd:0:1')).toBeNull();
  });

  it('returns null for unrelated codes', () => {
    expect(parseTicket('012345678905')).toBeNull();
    expect(parseTicket('')).toBeNull();
  });
});
