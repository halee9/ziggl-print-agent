import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import type { AgentConfig } from './config';
import type { KDSOrder } from './types';
import { buildLabelSvg, expandItems } from './label';
import { log } from './log';

/**
 * Rollo(USB) 레이블 인쇄 — Star처럼 TCP가 아니라 Windows 프린터 드라이버 경유.
 * SVG → PNG(레이블 도트 크기) → 1장짜리 PDF → pdf-to-printer(SumatraPDF)로 무대화상자 출력.
 * Windows 전용 — 다른 OS에선 렌더만 하고 스킵 (개발용).
 */
export async function renderLabelPng(svg: string, widthPx: number, heightPx: number): Promise<Buffer> {
  // 내용이 길면 contain으로 축소 — 잘리는 것보다 작게라도 다 보이게
  return sharp(Buffer.from(svg))
    .resize({ width: widthPx, height: heightPx, fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer();
}

async function pngToPdf(png: Buffer, widthIn: number, heightIn: number): Promise<Buffer> {
  const pageW = widthIn * 72; // PDF pt
  const pageH = heightIn * 72;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [pageW, pageH], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.image(png, 0, 0, { width: pageW, height: pageH });
    doc.end();
  });
}

/** 주문의 모든 레이블(아이템×수량) 인쇄. 성공한 장수 반환 */
export async function printOrderLabels(order: KDSOrder, config: AgentConfig): Promise<number> {
  const items = expandItems(order.lineItems);
  if (items.length === 0) return 0;

  const widthPx = Math.round(config.labelWidthIn * config.labelDpi);
  const heightPx = Math.round(config.labelHeightIn * config.labelDpi);
  let printed = 0;

  for (const [i, item] of items.entries()) {
    const svg = buildLabelSvg(item, order.displayId, {
      widthPx, heightPx, fontFamily: config.fontFamily || undefined,
    });
    const png = await renderLabelPng(svg, widthPx, heightPx);
    const pdf = await pngToPdf(png, config.labelWidthIn, config.labelHeightIn);

    if (process.platform !== 'win32') {
      log.warn(`label ${i + 1}/${items.length}: non-Windows platform — render only, print skipped`);
      printed++;
      continue;
    }

    const tmp = path.join(os.tmpdir(), `ziggl-label-${order.id}-${i}.pdf`);
    fs.writeFileSync(tmp, pdf);
    try {
      // 동적 로드 — Windows 외 플랫폼에서 모듈 부작용 방지
      const { print } = await import('pdf-to-printer');
      await print(tmp, {
        printer: config.labelPrinterName,
        scale: 'fit',
      });
      printed++;
      log.info(`label ${i + 1}/${items.length} sent to "${config.labelPrinterName}" (#${order.displayId} ${item.name})`);
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* 정리 실패 무시 */ }
    }
  }
  return printed;
}
