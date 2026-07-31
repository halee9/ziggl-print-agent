import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import sharp from 'sharp';
import type { AgentConfig } from './config';
import type { KDSOrder } from './types';
import { buildLabelSvg, expandItems } from './label';
import { buildTsplJob } from './tspl';
import { log } from './log';

/**
 * Rollo(USB) 레이블 인쇄 — TSPL raw 방식.
 * PDF+드라이버 경로는 드라이버가 용지 크기를 4x6으로 오판해 축소·스킵을 일으켰음.
 * TSPL(셀프테스트 COMMAND SET에서 확인)은 프린터 네이티브 명령이라 크기·갭을
 * 잡 안에서 직접 지시 → 드라이버 용지 설정과 무관하게 정확히 인쇄됨.
 * 전송은 Windows 스풀러 RAW (scripts/rawprint.ps1, winspool P/Invoke).
 */
export async function renderLabelPng(svg: string, widthPx: number, heightPx: number): Promise<Buffer> {
  // 내용이 길면 contain으로 축소 — 잘리는 것보다 작게라도 다 보이게
  return sharp(Buffer.from(svg))
    .resize({ width: widthPx, height: heightPx, fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .threshold(160)
    .png()
    .toBuffer();
}

function sendRaw(printerName: string, jobFile: string): Promise<void> {
  const script = path.join(__dirname, '../scripts/rawprint.ps1');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-PrinterName', printerName, '-FilePath', jobFile],
      { timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`raw print failed: ${stderr || err.message}`));
        else if (!String(stdout).includes('OK')) reject(new Error(`raw print failed: ${stderr || stdout}`));
        else resolve();
      },
    );
  });
}

/** 주문의 모든 레이블(아이템×수량)을 단일 TSPL 잡으로 인쇄. 장수 반환 */
export async function printOrderLabels(order: KDSOrder, config: AgentConfig): Promise<number> {
  const items = expandItems(order.lineItems);
  if (items.length === 0) return 0;

  const widthPx = Math.round(config.labelWidthIn * config.labelDpi);
  const heightPx = Math.round(config.labelHeightIn * config.labelDpi);

  const pngs: Buffer[] = [];
  for (const item of items) {
    const svg = buildLabelSvg(item, order.displayId, {
      widthPx, heightPx, fontFamily: config.fontFamily || undefined,
    });
    pngs.push(await renderLabelPng(svg, widthPx, heightPx));
  }

  const job = await buildTsplJob(pngs, {
    widthMm: config.labelWidthIn * 25.4,
    heightMm: config.labelHeightIn * 25.4,
    gapMm: config.labelGapMm,
    density: config.labelDensity,
  });

  if (process.platform !== 'win32') {
    log.warn(`labels: non-Windows platform — rendered ${pngs.length} label(s), print skipped`);
    return pngs.length;
  }

  const tmp = path.join(os.tmpdir(), `ziggl-labels-${order.id}-${Date.now()}.prn`);
  fs.writeFileSync(tmp, job);
  try {
    await sendRaw(config.labelPrinterName, tmp);
    log.info(`${pngs.length} label(s) sent to "${config.labelPrinterName}" as one TSPL job (#${order.displayId})`);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* 정리 실패 무시 */ }
  }
  return pngs.length;
}
