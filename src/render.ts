import { transform } from 'receiptline';
import sharp from 'sharp';

/** 80mm 용지 = 576도트 = 48chars × 12px — 용지 폭은 고정 */
const PRINTER_CPL = 48;
const PRINTER_DOTS = PRINTER_CPL * 12;

/**
 * TSP100은 래스터 전용이라 receiptline stargraphic은 텍스트를 직접 못 그림.
 * 파이프라인: 마크업 → SVG → PNG 래스터화 → {image:} 문서로 stargraphic 변환.
 *
 * 인쇄 품질 핵심 두 가지:
 * - cpl(글자 밀도)을 용지 폭(48)보다 작게 잡고 SVG를 벡터 단계(density)에서 576도트로
 *   확대 렌더 → 글자가 커지고 획이 두꺼워짐 (cpl 36 ≈ 48 대비 1.33배 크기)
 * - threshold로 안티앨리어싱 회색을 전부 진한 검정으로 강제 + stargraphic은
 *   gradient:false — 디더링(흐린 점 흩뿌리기) 방지
 */
export async function renderSvg(doc: string, cpl: number): Promise<string> {
  return transform(doc, { command: 'svg', cpl, spacing: true });
}

export async function renderTicketPng(doc: string, cpl: number, threshold = 200): Promise<Buffer> {
  const svg = renderSvgSync(doc, cpl);
  const svgWidth = cpl * 12;
  // 72dpi 기준 벡터 확대 — 래스터 업스케일과 달리 획이 뭉개지지 않음
  const density = (72 * PRINTER_DOTS) / svgWidth;
  return sharp(Buffer.from(svg), { density })
    .resize({ width: PRINTER_DOTS })
    .flatten({ background: '#ffffff' })
    .threshold(threshold)
    .png()
    .toBuffer();
}

export async function renderStarGraphic(doc: string, cpl: number, threshold = 200): Promise<Buffer> {
  const png = await renderTicketPng(doc, cpl, threshold);
  const imageDoc = `{image:${png.toString('base64')}}`;
  const bin = transform(imageDoc, {
    command: 'stargraphic',
    cpl: PRINTER_CPL,
    gradient: false, // threshold 이진화 유지 — 디더링 금지
    cutting: true,
  });
  return Buffer.from(bin, 'binary');
}

function renderSvgSync(doc: string, cpl: number): string {
  return transform(doc, { command: 'svg', cpl, spacing: true });
}
