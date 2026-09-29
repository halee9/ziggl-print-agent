// npm run test-date-label — 날짜 레이블을 data/date-label.png로 렌더하고 (Windows면) Rollo로 출력
//   -- --preview-only          인쇄 없이 PNG만
//   -- --at 2026-09-29T22:42:00Z --tz America/Los_Angeles --copies 2 --out path.png
import fs from 'node:fs';
import path from 'node:path';
import { renderDateLabelPng, printDateLabel } from '../labelPrinter';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const previewOnly = process.argv.includes('--preview-only');
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
  const printedAt = arg('--at') ?? new Date().toISOString();
  const timezone = arg('--tz') ?? c.timezoneFallback ?? 'America/Los_Angeles';
  const copies = parseInt(arg('--copies') ?? '1', 10) || 1;
  const out = arg('--out') ?? path.join(__dirname, '../../data/date-label.png');

  const png = await renderDateLabelPng(printedAt, timezone, config);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, png);
  console.log(`rendered date label (${printedAt} ${timezone}) → ${out}`);

  if (previewOnly) return;
  if (!config.labelPrinterName) {
    console.log('labelPrinterName not set in config.json — preview only. Set it to print.');
    return;
  }
  const printed = await printDateLabel({ printedAt, timezone, copies }, config as any);
  console.log(`sent ${printed} date label(s) to "${config.labelPrinterName}"`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
