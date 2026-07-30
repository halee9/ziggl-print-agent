import { transform } from 'receiptline';
import sharp from 'sharp';

/**
 * TSP100은 래스터 전용이라 receiptline stargraphic은 텍스트를 직접 못 그림.
 * 공식 경로: 마크업 → SVG → PNG 래스터화 → {image:} 문서로 stargraphic 변환.
 */
export async function renderSvg(doc: string, cpl: number): Promise<string> {
  return transform(doc, { command: 'svg', cpl, spacing: true });
}

export async function renderStarGraphic(doc: string, cpl: number): Promise<Buffer> {
  const svg = transform(doc, { command: 'svg', cpl, spacing: true });
  const png = await sharp(Buffer.from(svg)).flatten({ background: '#ffffff' }).png().toBuffer();
  const imageDoc = `{image:${png.toString('base64')}}`;
  const bin = transform(imageDoc, { command: 'stargraphic', cpl, cutting: true });
  return Buffer.from(bin, 'binary');
}
