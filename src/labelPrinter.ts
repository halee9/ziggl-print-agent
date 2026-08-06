import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import sharp from 'sharp';
import QRCode from 'qrcode';
import type { AgentConfig } from './config';
import type { KDSOrder, MenuDisplayConfig } from './types';
import { buildLabelSvg, expandItems, type LabelItem } from './label';
import { buildTsplJob } from './tspl';
import { log } from './log';

// 레이블 오른쪽에 아이템 완료 스캔용 QR 배치.
// 텍스트 SVG는 축소될 수 있지만 QR은 최종 픽셀에 고정 크기로 합성 — 스캔 가능성 보장.
// width 옵션(비정수 스케일)은 모듈 폭이 2~3px로 들쭉날쭉해져 실물 스캔 실패 —
// 반드시 정수 scale로 생성 (4px/모듈 = 0.5mm @203dpi, 실측 검증됨).
const QR_ZONE_PX = 118;   // 오른쪽 예약 폭
const QR_SCALE = 4;       // px per module
/** 주문 ID 뒤 10자만 페이로드에 사용 — QR 버전을 낮춰 모듈을 크게 유지. POS는 suffix 매칭 */
const QR_ID_SUFFIX_LEN = 10;

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

/**
 * 레이블 1장 렌더: 텍스트(왼쪽) + 완료 스캔 QR(오른쪽, `zgi:<orderId>:<lineIdx>:<unitIdx>`).
 * KDS에서 이 QR을 스캔하면 해당 단위가 완료 처리됨.
 */
export async function renderLabelWithQr(
  item: LabelItem,
  order: Pick<KDSOrder, 'id' | 'displayId'>,
  opts: { widthPx: number; heightPx: number; fontFamily?: string },
): Promise<Buffer> {
  const { widthPx, heightPx } = opts;
  const svg = buildLabelSvg(item, order.displayId, {
    widthPx: widthPx - QR_ZONE_PX,
    heightPx,
    fontFamily: opts.fontFamily,
  });
  const textPng = await renderLabelPng(svg, widthPx - QR_ZONE_PX, heightPx);
  const payload = `zgi:${order.id.slice(-QR_ID_SUFFIX_LEN)}:${item.lineIdx}:${item.unitIdx}`;
  let qrPng = await QRCode.toBuffer(payload, { errorCorrectionLevel: 'M', margin: 1, scale: QR_SCALE });
  let qrSize = (await sharp(qrPng).metadata()).width!;
  if (qrSize > QR_ZONE_PX || qrSize > heightPx) {
    // 안전장치: 페이로드가 길어져 QR 버전이 올라가면 한 단계 작은 스케일로
    qrPng = await QRCode.toBuffer(payload, { errorCorrectionLevel: 'M', margin: 1, scale: QR_SCALE - 1 });
    qrSize = (await sharp(qrPng).metadata()).width!;
  }
  return sharp({
    create: { width: widthPx, height: heightPx, channels: 3, background: '#ffffff' },
  })
    .composite([
      { input: textPng, left: 0, top: 0 },
      {
        input: qrPng,
        left: widthPx - QR_ZONE_PX + Math.floor((QR_ZONE_PX - qrSize) / 2),
        top: Math.floor((heightPx - qrSize) / 2),
      },
    ])
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
export async function printOrderLabels(order: KDSOrder, config: AgentConfig, menu?: MenuDisplayConfig): Promise<number> {
  // print_label=false인 아이템(소스류 등)은 레이블 제외 — POS 메뉴 관리(menu_display)에서 설정
  // 필터를 expandItems 안에서 적용해 lineIdx가 원본 배열 기준으로 유지되도록 함 (QR 좌표 정합성)
  const items = expandItems(order.lineItems, (li) => {
    const cfg = menu?.menuItems.find((m) => m.item_name.toLowerCase().trim() === li.name.toLowerCase().trim());
    return cfg?.print_label !== false;
  });
  if (items.length === 0) return 0;

  const widthPx = Math.round(config.labelWidthIn * config.labelDpi);
  const heightPx = Math.round(config.labelHeightIn * config.labelDpi);

  const pngs: Buffer[] = [];
  for (const item of items) {
    pngs.push(await renderLabelWithQr(item, order, {
      widthPx, heightPx, fontFamily: config.fontFamily || undefined,
    }));
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
