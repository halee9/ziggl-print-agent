import type { KDSOrder, OrderModifier } from './types';
import { normalizeMod, formatMoney } from './ticket';

// ziggl-pos ItemLabelPrinter.tsx 포팅 — 아이템×수량마다 스티커 레이블 1장

export interface LabelItem {
  name: string;
  variationName?: string;
  modifiers: OrderModifier[];
  note?: string;
  /** 원본 order.lineItems 배열에서의 인덱스 — 스캔 페이로드(zgi:)가 POS와 공유하는 좌표 */
  lineIdx: number;
  /** 같은 라인 내 몇 번째 단위인지 (qty=3 → 0,1,2) */
  unitIdx: number;
}

/** qty=2 → 레이블 2장 (ItemLabelPrinter.expandItems 포팅). shouldPrint로 제외해도 lineIdx는 원본 기준 유지 */
export function expandItems(
  lineItems: KDSOrder['lineItems'],
  shouldPrint?: (item: KDSOrder['lineItems'][number]) => boolean,
): LabelItem[] {
  const result: LabelItem[] = [];
  for (const [lineIdx, item] of lineItems.entries()) {
    if (shouldPrint && !shouldPrint(item)) continue;
    const qty = parseInt(item.quantity, 10) || 1;
    for (let i = 0; i < qty; i++) {
      result.push({
        name: item.name,
        variationName: item.variationName,
        modifiers: (item.modifiers ?? []).map(normalizeMod),
        note: item.note,
        lineIdx,
        unitIdx: i,
      });
    }
  }
  return result;
}

/**
 * 단체주문 아이템 note에서 수령인 이름 파싱.
 * - DoorDash: "Label: Jared A"
 * - UberEats: "(Please label for Marshall)"
 * 매치되는 첫 줄의 이름을 labelName으로, 나머지 줄은 restNote로 반환.
 * (ziggl-pos/admin utils.ts에 동일 구현 — no shared packages 관례)
 */
const LABEL_NOTE_PATTERNS = [
  /^\s*label:\s*(\S.*?)\s*$/i,
  /^\s*\(?\s*please label for\s+(\S.*?)\s*\)?\s*$/i,
];

export function parseLabelNote(note?: string): { labelName: string | null; restNote: string | null } {
  if (!note) return { labelName: null, restNote: null };
  const lines = note.split('\n');
  const idx = lines.findIndex((l) => LABEL_NOTE_PATTERNS.some((re) => re.test(l)));
  if (idx === -1) return { labelName: null, restNote: note };
  let labelName = '';
  for (const re of LABEL_NOTE_PATTERNS) {
    const m = lines[idx].match(re);
    if (m) { labelName = m[1].trim(); break; }
  }
  const rest = lines.filter((_, i) => i !== idx).join('\n').trim();
  return { labelName, restNote: rest || null };
}

function xmlEsc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export interface LabelRenderOptions {
  widthPx: number;   // 예: 2" × 203dpi = 406
  heightPx: number;  // 예: 1" × 203dpi = 203
  fontFamily?: string;
}

interface Line {
  text: string;
  size: number;
  bold: boolean;
  italic?: boolean;
}

/**
 * 레이블 1장 → SVG. 내용이 높이를 넘치면 전체를 비율 축소해서라도 다 보이게 함
 * (긴 모디파이어 목록에서 잘리는 것보다 작아지는 게 낫다).
 */
export function buildLabelSvg(item: LabelItem, displayId: string, opts: LabelRenderOptions): string {
  const W = opts.widthPx;
  const font = opts.fontFamily
    ? `'${opts.fontFamily.replace(/['"\\]/g, '')}', 'Consolas', 'Courier New', monospace`
    : `'Consolas', 'Courier New', monospace`;

  // 원본 레이블(280px) 대비 비율: text-lg 18→26, text-2xl 24→35, text-base 16→23
  // 모든 라인을 폭 기준으로 줄바꿈 (모노스페이스 0.62em 기준 줄당 글자수)
  const lines: Line[] = [];
  const push = (text: string, size: number, bold: boolean, italic = false, maxLines = 99) => {
    const cols = Math.floor(W / (size * 0.62));
    for (const chunk of wrap(text, cols).slice(0, maxLines)) {
      lines.push({ text: chunk, size, bold, italic });
    }
  };
  // 단체주문(DoorDash/UberEats): note의 수령인 이름 — 상단에 크게 인쇄
  const { labelName, restNote } = parseLabelNote(item.note);
  push(`ORDER #${displayId.padStart(3, '0')}`, 26, true);
  if (labelName) push(labelName, 30, true, false, 1);
  push(item.name, 35, true, false, 2);
  if (item.variationName) push(item.variationName, 24, false);
  for (const m of item.modifiers) {
    const price = m.price > 0 ? ` ${formatMoney(m.price * m.qty)}` : '';
    push(`${m.qty > 1 ? `${m.qty}x ` : ''}${m.name}${price}`, 24, false);
  }
  if (restNote) push(`* ${restNote}`, 21, false, true);

  const lineGap = 6;
  const padding = 10;
  const contentH = lines.reduce((h, l) => h + l.size + lineGap, 0) + padding * 2;

  let y = padding;
  const texts = lines.map((l) => {
    y += l.size;
    const t = `<text x="${W / 2}" y="${y}" text-anchor="middle" font-size="${l.size}"` +
      `${l.bold ? ' font-weight="bold"' : ''}${l.italic ? ' font-style="italic"' : ''}>${xmlEsc(l.text)}</text>`;
    y += lineGap;
    return t;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${contentH}" viewBox="0 0 ${W} ${contentH}">` +
    `<rect width="100%" height="100%" fill="#fff"/>` +
    `<g font-family="${xmlEsc(font)}" fill="#000">${texts.join('')}</g></svg>`;
}

/** 단어 경계 우선 줄바꿈 (단어가 컬럼보다 길면 강제 분할) */
function wrap(text: string, cols: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= cols) cur += ' ' + w;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out.flatMap((line) => {
    const chunks: string[] = [];
    for (let i = 0; i < line.length; i += cols) chunks.push(line.slice(i, i + cols));
    return chunks;
  });
}
