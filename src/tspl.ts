import sharp from 'sharp';

/**
 * TSPL(TSC Printer Language) 잡 생성 — Rollo 셀프테스트에서 COMMAND SET: TSPL 확인됨.
 * Windows 드라이버의 용지 설정을 완전히 우회하고 프린터에 직접 크기·갭·비트맵을 지시:
 * 드라이버가 4x6으로 오판해 글씨가 축소되고 라벨이 스킵되던 문제를 원천 차단.
 */

export interface TsplLabelOptions {
  widthMm: number;   // 50.8 (2")
  heightMm: number;  // 25.4 (1")
  gapMm: number;     // 라벨 사이 갭 (셀프테스트 GAP LEN: 2mm)
  density: number;   // 인쇄 농도 0-15 (셀프테스트 DARKNESS: 6)
}

/** PNG(흑백) → TSPL BITMAP 데이터 (1bpp, MSB first, TSPL은 bit 0=검정/1=흰색) */
export async function pngToTsplBitmap(png: Buffer): Promise<{ widthBytes: number; height: number; data: Buffer }> {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const widthBytes = Math.ceil(w / 8);
  const out = Buffer.alloc(widthBytes * h, 0xff); // 기본 흰색(1)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = data[y * w + x];
      if (px < 128) {
        // 검정 → 해당 비트를 0으로
        out[y * widthBytes + (x >> 3)] &= ~(0x80 >> (x & 7));
      }
    }
  }
  return { widthBytes, height: h, data: out };
}

/** 라벨 PNG 목록 → 단일 TSPL 잡 (라벨당 CLS+BITMAP+PRINT) */
export async function buildTsplJob(pngs: Buffer[], opts: TsplLabelOptions): Promise<Buffer> {
  const parts: Buffer[] = [];
  const line = (s: string) => parts.push(Buffer.from(s + '\r\n', 'ascii'));

  line(`SIZE ${opts.widthMm} mm,${opts.heightMm} mm`);
  line(`GAP ${opts.gapMm} mm,0 mm`);
  line(`DENSITY ${opts.density}`);
  line('SPEED 4');
  line('DIRECTION 1');
  line('REFERENCE 0,0');

  for (const png of pngs) {
    const { widthBytes, height, data } = await pngToTsplBitmap(png);
    line('CLS');
    parts.push(Buffer.from(`BITMAP 0,0,${widthBytes},${height},0,`, 'ascii'));
    parts.push(data);
    parts.push(Buffer.from('\r\n', 'ascii'));
    line('PRINT 1,1');
  }
  return Buffer.concat(parts);
}
