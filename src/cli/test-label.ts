// npm run test-label — 픽스처 주문의 레이블을 렌더하고 (Windows면) Rollo로 실물 출력
// npm run test-label -- --preview-only  → 인쇄 없이 data/label-N.png만 생성
import fs from 'node:fs';
import path from 'node:path';
import { expandItems } from '../label';
import { renderLabelWithQr, printOrderLabels } from '../labelPrinter';
import type { KDSOrder } from '../types';

async function main() {
  const previewOnly = process.argv.includes('--preview-only');
  const countArg = process.argv.indexOf('--count');
  const maxLabels = countArg >= 0 ? parseInt(process.argv[countArg + 1], 10) || 2 : 2;
  const order: KDSOrder = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../fixtures/sample-order.json'), 'utf-8')
  );
  // 스티커 절약 — 수량을 1로 줄이고 앞에서 maxLabels개 아이템만 사용 (기본 2장)
  order.lineItems = order.lineItems.slice(0, maxLabels).map((li) => ({ ...li, quantity: '1' }));

  const configPath = path.join(process.cwd(), 'config.json');
  const c = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};
  const config = {
    labelPrinterName: c.labelPrinterName ?? '',
    labelWidthIn: c.labelWidthIn ?? 2,
    labelHeightIn: c.labelHeightIn ?? 1,
    labelDpi: c.labelDpi ?? 203,
    labelGapMm: c.labelGapMm ?? 2,
    labelDensity: c.labelDensity ?? 8,
    fontFamily: c.fontFamily ?? 'Consolas',
  };

  const widthPx = Math.round(config.labelWidthIn * config.labelDpi);
  const heightPx = Math.round(config.labelHeightIn * config.labelDpi);
  const items = expandItems(order.lineItems);
  const outDir = path.join(__dirname, '../../data');
  fs.mkdirSync(outDir, { recursive: true });

  for (const [i, item] of items.entries()) {
    const png = await renderLabelWithQr(item, order, { widthPx, heightPx, fontFamily: config.fontFamily });
    fs.writeFileSync(path.join(outDir, `label-${i + 1}.png`), png);
  }
  console.log(`rendered ${items.length} label(s) → data/label-*.png (${widthPx}x${heightPx}px)`);

  if (previewOnly) return;
  if (!config.labelPrinterName) {
    console.log('labelPrinterName not set in config.json — preview only. Set it to print.');
    return;
  }
  const printed = await printOrderLabels(order, config as any);
  console.log(`sent ${printed} label(s) to "${config.labelPrinterName}"`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
