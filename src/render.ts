import { transform } from 'receiptline';
import sharp from 'sharp';
import type { TicketParts } from './ticket';

/** 80mm 용지 = 576도트 = 48chars × 12px — 용지 폭은 고정 */
const PRINTER_DOTS = 576;
const PRINTER_CPL = 48;
/** 주문번호/QR 패널의 마크업 폭(글자수) — 4배 확대 숫자 3자리가 딱 맞는 크기 */
const PANEL_CPL = 12;
/** 좌(번호)/우(QR) 패널의 출력 폭 */
const LEFT_W = 288;
const RIGHT_W = 288;

/**
 * TSP100은 래스터 전용이라 receiptline stargraphic은 텍스트를 직접 못 그림.
 * 파이프라인: 마크업 → SVG → (벡터 확대) PNG → 패널 합성 → {image:} → stargraphic.
 *
 * 인쇄 품질 핵심:
 * - cpl(글자 밀도)을 용지 폭(48)보다 작게 잡고 SVG를 벡터 단계(density)에서
 *   576도트로 확대 렌더 → 글자가 커지고 획이 두꺼워짐 (cpl 30 ≈ 원본 티켓 크기)
 * - threshold 이진화 + stargraphic gradient:false — 디더링으로 흐려지는 것 방지
 * - 주문번호(좌)와 QR(우)은 별도 패널로 렌더 후 좌우 합성 (원본 레이아웃)
 */
export async function renderSvg(doc: string, cpl: number): Promise<string> {
  return transform(doc, { command: 'svg', cpl, spacing: true });
}

async function panelPng(doc: string, cpl: number, targetWidth: number, threshold: number): Promise<Buffer> {
  const svg = transform(doc, { command: 'svg', cpl, spacing: true });
  const density = (72 * targetWidth) / (cpl * 12);
  return sharp(Buffer.from(svg), { density })
    .resize({ width: targetWidth })
    .flatten({ background: '#ffffff' })
    .threshold(threshold)
    .png()
    .toBuffer();
}

async function heightOf(png: Buffer): Promise<number> {
  return (await sharp(png).metadata()).height ?? 0;
}

export async function renderTicketPng(parts: TicketParts, cpl: number, threshold = 200): Promise<Buffer> {
  const [header, left, right, body] = await Promise.all([
    panelPng(parts.header, cpl, PRINTER_DOTS, threshold),
    panelPng(parts.numberPanel, PANEL_CPL, LEFT_W, threshold),
    panelPng(parts.qrPanel, PANEL_CPL, RIGHT_W, threshold),
    panelPng(parts.body, cpl, PRINTER_DOTS, threshold),
  ]);

  const [headerH, leftH, rightH, bodyH] = await Promise.all([
    heightOf(header), heightOf(left), heightOf(right), heightOf(body),
  ]);
  const rowH = Math.max(leftH, rightH);
  const totalH = headerH + rowH + bodyH;

  return sharp({
    create: { width: PRINTER_DOTS, height: totalH, channels: 3, background: '#ffffff' },
  })
    .composite([
      { input: header, left: 0, top: 0 },
      { input: left, left: 0, top: headerH + Math.floor((rowH - leftH) / 2) },
      { input: right, left: LEFT_W, top: headerH + Math.floor((rowH - rightH) / 2) },
      { input: body, left: 0, top: headerH + rowH },
    ])
    .png()
    .toBuffer();
}

export async function renderStarGraphic(parts: TicketParts, cpl: number, threshold = 200): Promise<Buffer> {
  const png = await renderTicketPng(parts, cpl, threshold);
  const imageDoc = `{image:${png.toString('base64')}}`;
  const bin = transform(imageDoc, {
    command: 'stargraphic',
    cpl: PRINTER_CPL,
    gradient: false, // threshold 이진화 유지 — 디더링 금지
    cutting: true,
  });
  return Buffer.from(bin, 'binary');
}
