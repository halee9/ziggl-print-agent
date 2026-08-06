import { describe, it, expect } from 'vitest';
import { expandItems } from './label';
import { renderLabelWithQr } from './labelPrinter';
import type { KDSOrder } from './types';

const lineItems = [
  { name: 'Bulgogi Bowl', quantity: '2', modifiers: [], totalMoney: 2600 },
  { name: 'Gyoza', quantity: '1', modifiers: [], totalMoney: 700 },
  { name: 'Yum Yum Sauce', quantity: '1', modifiers: [], totalMoney: 100 },
] as unknown as KDSOrder['lineItems'];

describe('expandItems', () => {
  it('flattens qty into per-unit labels with lineIdx/unitIdx', () => {
    const items = expandItems(lineItems);
    expect(items.map((i) => [i.name, i.lineIdx, i.unitIdx])).toEqual([
      ['Bulgogi Bowl', 0, 0],
      ['Bulgogi Bowl', 0, 1],
      ['Gyoza', 1, 0],
      ['Yum Yum Sauce', 2, 0],
    ]);
  });

  it('keeps original lineIdx when items are filtered out', () => {
    const items = expandItems(lineItems, (li) => li.name !== 'Gyoza');
    expect(items.map((i) => [i.name, i.lineIdx, i.unitIdx])).toEqual([
      ['Bulgogi Bowl', 0, 0],
      ['Bulgogi Bowl', 0, 1],
      ['Yum Yum Sauce', 2, 0], // Gyoza(1) 제외돼도 원본 인덱스 2 유지
    ]);
  });
});

describe('renderLabelWithQr', () => {
  it('renders a decodable short-suffix QR with uniform >=4px modules (real-length order id)', async () => {
    const items = expandItems(lineItems);
    const item = items[1]; // Bulgogi Bowl unit 2 → lineIdx 0, unitIdx 1
    const orderId = 'N6CQMj4kkkriDeeswIhUkQt7qZNZY'; // 실제 Square 주문 ID 길이(29자)
    const png = await renderLabelWithQr(item, { id: orderId, displayId: '42' }, {
      widthPx: 406,
      heightPx: 203,
    });
    const sharp = (await import('sharp')).default;
    const jsQR = (await import('jsqr')).default;
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(406);
    expect(meta.height).toBe(203);
    // TSPL 변환과 동일한 threshold(128) 시뮬레이션 후에도 디코드되어야 함
    const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
    const rgba = new Uint8ClampedArray(info.width * info.height * 4);
    for (let i = 0; i < info.width * info.height; i++) {
      const v = data[i] < 128 ? 0 : 255;
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
    const decoded = jsQR(rgba, info.width, info.height);
    expect(decoded?.data).toBe(`zgi:${orderId.slice(-10)}:0:1`);
    // 모듈 폭 균일성: QR 중앙 행의 최소 검정 런이 4px 이상 (물리 스캔 신뢰성)
    const qrTop = decoded!.location.topLeftCorner;
    const qrBottom = decoded!.location.bottomRightCorner;
    const midY = Math.round((qrTop.y + qrBottom.y) / 2);
    const runs: number[] = [];
    let cur = 0;
    for (let x = Math.floor(qrTop.x); x <= Math.ceil(qrBottom.x); x++) {
      if (data[midY * info.width + x] < 128) cur++;
      else if (cur > 0) { runs.push(cur); cur = 0; }
    }
    if (cur > 0) runs.push(cur);
    expect(Math.min(...runs)).toBeGreaterThanOrEqual(4);
  });
});
