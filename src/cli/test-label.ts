// npm run test-label — 픽스처 주문의 레이블을 렌더하고 (Windows면) Rollo로 실물 출력
// npm run test-label -- --preview-only  → 인쇄 없이 data/label-N.png만 생성
import fs from 'node:fs';
import path from 'node:path';
import { buildLabelSvg, expandItems } from '../label';
import { renderLabelPng, printOrderLabels } from '../labelPrinter';
import type { KDSOrder } from '../types';

async function main() {
  const previewOnly = process.argv.includes('--preview-only');
  const order: KDSOrder = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../fixtures/sample-order.json'), 'utf-8')
  );

  const configPath = path.join(process.cwd(), 'config.json');
  const c = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};
  const config = {
    labelPrinterName: c.labelPrinterName ?? '',
    labelWidthIn: c.labelWidthIn ?? 2,
    labelHeightIn: c.labelHeightIn ?? 1,
    labelDpi: c.labelDpi ?? 203,
    fontFamily: c.fontFamily ?? 'Consolas',
  };

  const widthPx = Math.round(config.labelWidthIn * config.labelDpi);
  const heightPx = Math.round(config.labelHeightIn * config.labelDpi);
  const items = expandItems(order.lineItems);
  const outDir = path.join(__dirname, '../../data');
  fs.mkdirSync(outDir, { recursive: true });

  for (const [i, item] of items.entries()) {
    const svg = buildLabelSvg(item, order.displayId, { widthPx, heightPx, fontFamily: config.fontFamily });
    const png = await renderLabelPng(svg, widthPx, heightPx);
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
