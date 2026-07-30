import { transform } from 'receiptline';
import sharp from 'sharp';
import type { TicketLayout } from './ticket';

/** 80mm 용지 = 576도트 = 48chars × 12px — 용지 폭은 고정 */
const PRINTER_DOTS = 576;
const PRINTER_CPL = 48;
/** 주문번호 패널의 마크업 폭(글자수) — 4배 확대 숫자 3자리가 딱 맞는 크기 */
const NUMBER_PANEL_CPL = 12;
/** 봉투 수 패널 — 번호보다 한 단계 작게 (아이템 텍스트와 비슷한 크기) */
const BAGS_PANEL_CPL = 16;
/** QR 패널 — cell 4 QR(~132px)이 원본(≈210도트)과 비슷해지는 밀도 */
const QR_PANEL_CPL = 15;
/** 좌(번호)/우(QR) 패널의 출력 폭 */
const LEFT_W = 288;
const RIGHT_W = 288;

/**
 * TSP100은 래스터 전용이라 receiptline stargraphic은 텍스트를 직접 못 그림.
 * 파이프라인: 섹션별 마크업 → SVG → (벡터 확대) PNG → 세로/좌우 합성 → {image:} → stargraphic.
 *
 * 인쇄 품질 핵심:
 * - 섹션마다 다른 cpl로 렌더해 원본 브라우저 티켓의 요소별 폰트 크기를 재현
 *   (receiptline은 문서 내 정수배 확대만 가능하므로 밀도를 바꿔 소수배를 얻음)
 * - threshold 이진화 + stargraphic gradient:false — 디더링으로 흐려지는 것 방지
 * - 주문번호(좌)와 QR(우)은 별도 패널로 렌더 후 좌우 합성 (원본 레이아웃)
 */
async function panelPng(doc: string, cpl: number, targetWidth: number, threshold: number, fontFamily?: string): Promise<Buffer> {
  let svg = transform(doc, { command: 'svg', cpl, spacing: true });
  if (fontFamily) {
    // 전역 <g font-family="..."> 하나만 교체 — 지정 폰트 없을 때를 대비해 기본 스택을 폴백으로 유지
    svg = svg.replace(
      /font-family="[^"]*"/,
      `font-family="'${fontFamily.replace(/['"\\]/g, '')}', 'Courier Prime', 'Courier New', monospace"`
    );
  }
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

interface Placed {
  input: Buffer;
  left: number;
  top: number;
}

export async function renderTicketPng(layout: TicketLayout, threshold = 200, fontFamily?: string): Promise<Buffer> {
  const placed: Placed[] = [];
  let y = 0;

  for (const seg of layout.before) {
    const png = await panelPng(seg.doc, seg.cpl, PRINTER_DOTS, threshold, fontFamily);
    placed.push({ input: png, left: 0, top: y });
    y += await heightOf(png);
  }

  // 주문번호+봉투수(좌) + QR(우) 행 — 봉투수는 번호보다 작은 밀도로 아래에 쌓음
  const [numberPng, bagsPng, right] = await Promise.all([
    panelPng(layout.numberPanel, NUMBER_PANEL_CPL, LEFT_W, threshold, fontFamily),
    panelPng(layout.bagsPanel, BAGS_PANEL_CPL, LEFT_W, threshold, fontFamily),
    panelPng(layout.qrPanel, QR_PANEL_CPL, RIGHT_W, threshold, fontFamily),
  ]);
  const [numberH, bagsH, rightH] = await Promise.all([heightOf(numberPng), heightOf(bagsPng), heightOf(right)]);
  const leftH = numberH + bagsH;
  const rowH = Math.max(leftH, rightH);
  const leftTop = y + Math.floor((rowH - leftH) / 2);
  placed.push({ input: numberPng, left: 0, top: leftTop });
  placed.push({ input: bagsPng, left: 0, top: leftTop + numberH });
  placed.push({ input: right, left: LEFT_W, top: y + Math.floor((rowH - rightH) / 2) });
  y += rowH;

  for (const seg of layout.after) {
    const png = await panelPng(seg.doc, seg.cpl, PRINTER_DOTS, threshold, fontFamily);
    placed.push({ input: png, left: 0, top: y });
    y += await heightOf(png);
  }

  return sharp({
    create: { width: PRINTER_DOTS, height: y, channels: 3, background: '#ffffff' },
  })
    .composite(placed)
    .png()
    .toBuffer();
}

export async function renderStarGraphic(layout: TicketLayout, threshold = 200, fontFamily?: string): Promise<Buffer> {
  const png = await renderTicketPng(layout, threshold, fontFamily);
  const imageDoc = `{image:${png.toString('base64')}}`;
  const bin = transform(imageDoc, {
    command: 'stargraphic',
    cpl: PRINTER_CPL,
    gradient: false, // threshold 이진화 유지 — 디더링 금지
    cutting: true,
  });
  return Buffer.from(bin, 'binary');
}
