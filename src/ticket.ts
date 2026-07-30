import type { KDSOrder, MenuDisplayConfig, OrderModifier, PrintSource } from './types';

// ── ziggl-pos/src/utils.ts 포팅 ────────────────────────────────────────────────

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** formatDateTime 포팅 — 브라우저 로컬 tz 대신 레스토랑 tz 명시 */
export function formatDateTime(isoString: string, timeZone: string): string {
  return new Date(isoString).toLocaleString('en-US', {
    timeZone,
    month: 'numeric', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export function normalizeMod(mod: any): OrderModifier {
  if (typeof mod === 'string') return { name: mod, qty: 1, price: 0 };
  return {
    name: mod?.name ?? String(mod ?? ''),
    qty: mod?.qty ?? mod?.quantity ?? 1,
    price: Number(mod?.price ?? 0),
  };
}

function itemLabel(name: string, menu: MenuDisplayConfig): { label: string; serverAlert: boolean } {
  const config = menu.menuItems.find((m) => m.item_name.toLowerCase().trim() === name.toLowerCase().trim());
  return { label: config?.abbreviation || name, serverAlert: config?.server_alert ?? false };
}

function modifierLabel(mod: OrderModifier, menu: MenuDisplayConfig): { label: string; serverAlert: boolean } {
  const config = menu.modifiers.find((m) => m.modifier_name.toLowerCase().trim() === mod.name.toLowerCase().trim());
  return { label: config?.abbreviation || mod.name, serverAlert: config?.server_alert ?? false };
}

// ── receiptline 마크업 생성 ────────────────────────────────────────────────────

/** receiptline 특수문자 이스케이프 — 사용자 텍스트(이름·노트)에 필수 */
export function esc(text: string): string {
  return String(text ?? '').replace(/[\\|{}^_"`~-]/g, (c) => '\\' + c);
}

export interface TicketOptions {
  timezone: string;
  serverUrl: string; // QR 대상
  menu: MenuDisplayConfig;
  printSource: PrintSource;
  /** 테스트에서 푸터 시각 고정용 */
  now?: Date;
}

/** 섹션별 마크업 + 글자 밀도(cpl). cpl이 작을수록 크게 인쇄됨 */
export interface TicketSegment {
  doc: string;
  cpl: number;
}

/** 좌우 합성 렌더링을 위한 티켓 레이아웃 — 번호/QR 행 위·아래의 세로 세그먼트들 */
export interface TicketLayout {
  before: TicketSegment[];
  numberPanel: string;
  /** 번호 아래 봉투 수 — 번호보다 작은 밀도로 별도 렌더 */
  bagsPanel: string;
  qrPanel: string;
  after: TicketSegment[];
}

/**
 * 원본 브라우저 티켓(280px, Firefox → 80mm 확대 인쇄)의 요소별 px 크기를
 * 576도트 기준 cpl로 환산한 값. 기준(base=30)이 바뀌면 전체가 비례 스케일.
 *   16px(주문타입·Total) → cpl 29~30 / 14px(아이템·NOTE) → 33 /
 *   12px(시각·결제) → 38 / 18px(알림 항목) → 26 / 10px(푸터) → 46
 */
const SECTION_CPL = {
  base: 30,   // 주문 타입 + ^^이름(=text-3xl 상당)
  times: 38,  // Order at / Pickup at
  items: 33,  // 라인아이템·모디파이어·합계 행·NOTE
  total: 29,  // Total 행 (원본 text-base bold)
  small: 38,  // 결제 수단
  alerts: 26, // !! CONFIRM 항목 (원본 text-lg font-black)
  footer: 46, // printed-at
};

/**
 * OrderTicketModal.tsx TicketContent 포팅 — 섹션별 밀도로 원본 크기 재현.
 * baseCpl(기본 30)을 바꾸면 모든 섹션이 비례해서 커지고 작아짐.
 */
export function buildTicketLayout(order: KDSOrder, opts: TicketOptions, baseCpl = 30): TicketLayout {
  const scale = (cpl: number) => Math.max(20, Math.round((cpl * baseCpl) / 30));
  const seg = (cpl: number, lines: string[]): TicketSegment => ({ doc: lines.join('\n'), cpl: scale(cpl) });
  const menu = opts.menu;
  const before: TicketSegment[] = [];
  const after: TicketSegment[] = [];

  // ── Header: 주문 타입 + 이름(대형 볼드) ──
  const orderType = `${order.source} ${order.isDelivery ? 'Delivery' : 'Pickup'}`;
  before.push(seg(SECTION_CPL.base, [
    `|${esc(orderType)}|`,
    // ^^^ = 가로세로 2배 — ^^는 세로만 2배(반폭)라 이름이 좁아 보임
    `|^^^"${esc(order.displayName || '-')}"|`,
  ]));

  // ── 주문/픽업 시각 (원본 text-xs) ──
  const times = [`|Order at ${esc(formatDateTime(order.createdAt, opts.timezone))}|`];
  if (order.pickupAt) times.push(`|Pickup at ${esc(formatDateTime(order.pickupAt, opts.timezone))}|`);
  times.push('----');
  before.push(seg(SECTION_CPL.times, times));

  // ── 좌: 주문번호(3자리 zero padding, 대형) ──
  // 패널 폭 12자: ^^^^^(4배)면 3자리, ^^^^(3배)면 4자리까지 들어감
  const displayId = order.displayId.padStart(3, '0');
  const idScale = displayId.length <= 3 ? '^^^^^' : displayId.length === 4 ? '^^^^' : '^^^';
  const numberPanel = `|${idScale}"${esc(displayId)}"|`;

  // ── 번호 아래 봉투 수 (번호 패널보다 작은 밀도로 별도 렌더) ──
  const bagCount = order.bagCount ?? 0;
  const bagsPanel = `|${bagCount > 0 ? `${bagCount} Bag${bagCount > 1 ? 's' : ''}` : 'No Bags'}|`;

  // ── 우: QR ──
  const qrPanel = `{code:${opts.serverUrl}/receipt/${order.id}; option:qrcode,4,l}`;

  // ── Line items ──
  // 아이템명(원본 text-sm bold)과 옵션 상세(원본 text-xs)는 크기가 달라
  // 세그먼트를 분리: 상세는 times 밀도 + 2칸 들여쓰기(폭 2짜리 빈 첫 컬럼).
  after.push(seg(SECTION_CPL.items, ['----']));
  for (const item of order.lineItems) {
    const qtyPrefix = item.quantity !== '1' ? `${esc(item.quantity)} ` : '';
    after.push(seg(SECTION_CPL.items, [
      '{align:left}', '{width:* 7}',
      `"${qtyPrefix}${esc(item.name)}" | "${formatMoney(item.totalMoney)}"`,
    ]));

    const details: string[] = [];
    if (item.variationName) {
      details.push(`\\  |${esc(item.variationName)} |`);
    }
    for (const raw of item.modifiers ?? []) {
      const mod = normalizeMod(raw);
      const modQty = mod.qty > 1 ? `${mod.qty}x ` : '';
      const modPrice = mod.price > 0 ? formatMoney(mod.price * mod.qty) : '';
      details.push(`\\  |${modQty}${esc(mod.name)} | ${modPrice}`);
    }
    if (item.note) {
      details.push(`\\  |'${esc(item.note)}' |`);
    }
    if (details.length > 0) {
      after.push(seg(SECTION_CPL.times, ['{align:left}', '{width:2 * 7}', ...details]));
    }
  }
  after.push(seg(SECTION_CPL.items, ['----']));

  // ── Totals 행들 (Total 제외) ──
  const totals: string[] = ['{align:left}', '{width:* 7}'];
  if (order.subtotal != null) totals.push(`Subtotal | ${formatMoney(order.subtotal)}`);
  const tax = order.tax ?? order.taxAmount;
  if (tax != null) totals.push(`Tax | ${formatMoney(tax)}`);
  if (order.bagFee != null && order.bagFee > 0) totals.push(`Bag Fee | ${formatMoney(order.bagFee)}`);
  if (order.loyaltyDiscount != null && order.loyaltyDiscount > 0) {
    totals.push(`Points Discount | \\-${formatMoney(order.loyaltyDiscount)}`);
  }
  if (order.tipAmount != null && order.tipAmount > 0) totals.push(`Tip | ${formatMoney(order.tipAmount)}`);
  if (totals.length > 2) after.push(seg(SECTION_CPL.items, totals));

  // ── Total (원본은 살짝만 큰 bold — 2배 확대 아님) ──
  after.push(seg(SECTION_CPL.total, [
    '{align:left}', '{width:* 7}',
    `"Total" | "${formatMoney(order.totalMoney)}"`,
  ]));

  // ── Payment (원본 text-xs) ──
  if (order.cardBrand || order.cardLast4 || order.paymentMethod) {
    const payment = order.paymentMethod === 'CASH'
      ? 'Cash'
      : [order.cardBrand, order.cardLast4 ? `**** ${order.cardLast4}` : ''].filter(Boolean).join(' ');
    if (payment) after.push(seg(SECTION_CPL.small, [`|${esc(payment)}|`]));
  }
  // customerPhone: 인쇄 제외 (브라우저 티켓의 print:hidden과 동일)

  // ── Server alerts (⚠ CONFIRM — 약어 사용, 원본 text-lg font-black) ──
  const alertMap = new Map<string, number>();
  for (const item of order.lineItems) {
    const qty = parseInt(item.quantity, 10) || 1;
    const d = itemLabel(item.name, menu);
    if (d.serverAlert) alertMap.set(d.label, (alertMap.get(d.label) ?? 0) + qty);
    for (const raw of item.modifiers ?? []) {
      const mod = normalizeMod(raw);
      const md = modifierLabel(mod, menu);
      if (md.serverAlert) alertMap.set(md.label, (alertMap.get(md.label) ?? 0) + mod.qty * qty);
    }
  }
  if (alertMap.size > 0) {
    const alerts: string[] = ['----', '{align:left}', '"!! CONFIRM:" |'];
    for (const [label, count] of alertMap) {
      alerts.push(`"${count} ${esc(label)}" |`);
    }
    after.push(seg(SECTION_CPL.alerts, alerts));
  }

  // ── Note / Delivery Note (원본 text-sm bold) ──
  if (order.note) {
    after.push(seg(SECTION_CPL.items, ['----', '{align:left}', `"NOTE: ${esc(order.note)}" |`]));
  }
  if (order.deliveryNote) {
    after.push(seg(SECTION_CPL.items, ['----', '{align:left}', `"DELIVERY: ${esc(order.deliveryNote)}" |`]));
  }

  // ── Print provenance footer (원본 10px) ──
  const now = opts.now ?? new Date();
  const printedAt = now.toLocaleTimeString('en-US', {
    timeZone: opts.timezone, hour: 'numeric', minute: '2-digit', hour12: true,
  });
  after.push(seg(SECTION_CPL.footer, [`|Printed at ${esc(printedAt)} \\- ${opts.printSource}|`]));

  return { before, numberPanel, bagsPanel, qrPanel, after };
}

/** 프리뷰·테스트용 — 세그먼트를 순서대로 이어붙인 단일 문서 */
export function buildTicketDoc(order: KDSOrder, opts: TicketOptions): string {
  const layout = buildTicketLayout(order, opts);
  return [
    ...layout.before.map((s) => s.doc),
    layout.numberPanel,
    layout.bagsPanel,
    layout.qrPanel,
    ...layout.after.map((s) => s.doc),
  ].join('\n');
}
