import type { AgentConfig } from './config';

// 날짜 레이블 (POS "Date Label") — 요일·날짜·시각만 크게. 영어 고정, 연도 없음, QR 없음.

export interface DateLabelPayload {
  printedAt: string; // ISO
  timezone: string;
  copies: number;
}

function partsOf(date: Date, timeZone: string, opts: Intl.DateTimeFormatOptions) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, ...opts }).formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return get;
}

/** ISO + IANA TZ → { line1: 'TUE SEP 29', line2: '3:42 PM' }. 잘못된 날짜/타임존은 throw */
export function formatDateLabel(printedAt: string, timezone: string): { line1: string; line2: string } {
  const date = new Date(printedAt);
  if (!printedAt || Number.isNaN(date.getTime())) throw new Error(`invalid printedAt: ${printedAt}`);
  const d = partsOf(date, timezone, { weekday: 'short', month: 'short', day: 'numeric' });
  const t = partsOf(date, timezone, { hour: 'numeric', minute: '2-digit', hour12: true });
  const line1 = `${d('weekday')} ${d('month')} ${d('day')}`.toUpperCase();
  const line2 = `${t('hour')}:${t('minute')} ${t('dayPeriod').toUpperCase()}`;
  return { line1, line2 };
}

function xmlEsc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const CHAR_W = 0.6;     // 모노스페이스 글자폭(em) 추정
const MAX_W_RATIO = 0.94;
const CAP_H = 0.72;     // 대문자/숫자 시각 높이(em) — 세로 배치용

/** 두 줄 날짜 레이블 SVG (widthPx×heightPx 고정). line2(시각)가 가장 크게 */
export function buildDateLabelSvg(
  line1: string,
  line2: string,
  opts: { widthPx: number; heightPx: number; fontFamily?: string },
): string {
  const W = opts.widthPx;
  const H = opts.heightPx;
  // label.ts와 동일한 폰트 규칙 (Windows sharp/librsvg — Consolas 우선)
  const font = opts.fontFamily
    ? `'${opts.fontFamily.replace(/['"\\]/g, '')}', 'Consolas', 'Courier New', monospace`
    : `'Consolas', 'Courier New', monospace`;
  const fit = (text: string, size: number) => {
    const maxSize = (W * MAX_W_RATIO) / (Math.max(text.length, 1) * CHAR_W);
    return Math.floor(Math.min(size, maxSize) * 10) / 10;
  };
  const s1 = fit(line1, H * 0.32);
  const s2 = fit(line2, H * 0.42);
  const h1 = s1 * CAP_H;
  const h2 = s2 * CAP_H;
  const gap = (H - h1 - h2) / 3;
  const y1 = Math.round(gap + h1);
  const y2 = Math.round(gap * 2 + h1 + h2);
  const text = (y: number, size: number, s: string) =>
    `<text x="${W / 2}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="bold">${xmlEsc(s)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="100%" height="100%" fill="#fff"/>` +
    `<g font-family="${xmlEsc(font)}" fill="#000">${text(y1, s1, line1)}${text(y2, s2, line2)}</g></svg>`;
}

/** socket `print:date-label` 가드 — 레이블 프린터 미설정/잘못된 페이로드면 null */
export function parseDateLabelPayload(payload: unknown, config: Pick<AgentConfig, 'labelPrinterName'>): DateLabelPayload | null {
  if (!config.labelPrinterName) return null;
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.printedAt !== 'string' || typeof p.timezone !== 'string' || !p.timezone) return null;
  const copies = Number(p.copies);
  if (!Number.isFinite(copies)) return null;
  try {
    formatDateLabel(p.printedAt, p.timezone); // 날짜·타임존 검증 (Intl은 잘못된 TZ에 RangeError)
  } catch {
    return null;
  }
  return { printedAt: p.printedAt, timezone: p.timezone, copies };
}
