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
  it('renders a full-size PNG containing the scan QR', async () => {
    const [item] = expandItems(lineItems);
    const png = await renderLabelWithQr(item, { id: 'ord_test1', displayId: '42' }, {
      widthPx: 406,
      heightPx: 203,
    });
    const sharp = (await import('sharp')).default;
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(406);
    expect(meta.height).toBe(203);
    // QR 영역(오른쪽 100px)에 검정 픽셀이 실제로 존재해야 함
    const { data, info } = await sharp(png)
      .extract({ left: 306, top: 0, width: 100, height: 203 })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let black = 0;
    for (let i = 0; i < info.width * info.height; i++) if (data[i] < 128) black++;
    expect(black).toBeGreaterThan(500);
  });
});
