import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { pngToTsplBitmap, buildTsplJob } from './tspl';

/** 좌반 검정, 우반 흰색인 8×2 PNG */
async function halfBlackPng(): Promise<Buffer> {
  const raw = Buffer.alloc(8 * 2 * 3);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 8; x++) {
      const v = x < 4 ? 0 : 255;
      const i = (y * 8 + x) * 3;
      raw[i] = v; raw[i + 1] = v; raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width: 8, height: 2, channels: 3 } }).png().toBuffer();
}

describe('pngToTsplBitmap', () => {
  it('packs 1bpp MSB-first with TSPL polarity (0=black, 1=white)', async () => {
    const { widthBytes, height, data } = await pngToTsplBitmap(await halfBlackPng());
    expect(widthBytes).toBe(1);
    expect(height).toBe(2);
    // 좌측 4px 검정(0000) + 우측 4px 흰색(1111) = 0b00001111
    expect(data[0]).toBe(0x0f);
    expect(data[1]).toBe(0x0f);
  });
});

describe('buildTsplJob', () => {
  it('emits size/gap header once and CLS+BITMAP+PRINT per label', async () => {
    const png = await halfBlackPng();
    const job = await buildTsplJob([png, png], { widthMm: 50.8, heightMm: 25.4, gapMm: 2, density: 8 });
    const text = job.toString('latin1');
    expect(text).toContain('SIZE 50.8 mm,25.4 mm');
    expect(text).toContain('GAP 2 mm,0 mm');
    expect(text).toContain('DENSITY 8');
    expect((text.match(/CLS/g) ?? []).length).toBe(2);
    expect((text.match(/PRINT 1,1/g) ?? []).length).toBe(2);
    expect((text.match(/BITMAP 0,0,1,2,0,/g) ?? []).length).toBe(2);
  });
});
