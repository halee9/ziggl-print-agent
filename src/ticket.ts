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

/** 좌우 합성 렌더링을 위한 티켓 분할 — header / 주문번호 패널 / QR 패널 / body */
export interface TicketParts {
  header: string;
  numberPanel: string;
  qrPanel: string;
  body: string;
}

/**
 * OrderTicketModal.tsx TicketContent 포팅.
 * 주문번호+QR은 원본처럼 좌우 배치 — receiptline 마크업으론 불가해서
 * 패널별 마크업을 반환하고 render.ts가 PNG 합성.
 */
export function buildTicketParts(order: KDSOrder, opts: TicketOptions): TicketParts {
  // ── Header ──
  const header: string[] = [];
  const orderType = `${order.source} ${order.isDelivery ? 'Delivery' : 'Pickup'}`;
  header.push(`|${esc(orderType)}|`);
  header.push(`|^^"${esc(order.displayName || '-')}"|`);
  header.push(`|Order at ${esc(formatDateTime(order.createdAt, opts.timezone))}|`);
  if (order.pickupAt) {
    header.push(`|Pickup at ${esc(formatDateTime(order.pickupAt, opts.timezone))}|`);
  }
  header.push('----');

  // ── 좌: 주문번호(대형) + 봉투 수 ── (패널 폭 12자 기준 — 4배 확대 시 3자리까지)
  const idScale = order.displayId.length > 3 ? '^^^' : '^^^^';
  const bagCount = order.bagCount ?? 0;
  const numberPanel = [
    `|${idScale}"${esc(order.displayId)}"|`,
    `|${bagCount > 0 ? `${bagCount} Bag${bagCount > 1 ? 's' : ''}` : 'No Bags'}|`,
  ].join('\n');

  // ── 우: QR ──
  const qrPanel = `{code:${opts.serverUrl}/receipt/${order.id}; option:qrcode,4,l}`;

  const body = buildBody(order, opts);
  return { header: header.join('\n'), numberPanel, qrPanel, body };
}

/** 프리뷰·테스트용 — 패널을 순서대로 이어붙인 단일 문서 */
export function buildTicketDoc(order: KDSOrder, opts: TicketOptions): string {
  const p = buildTicketParts(order, opts);
  return [p.header, p.numberPanel, p.qrPanel, p.body].join('\n');
}

function buildBody(order: KDSOrder, opts: TicketOptions): string {
  const lines: string[] = [];
  const menu = opts.menu;
  lines.push('----');

  // ── Line items ── (이름 컬럼 최대 확보, 가격 컬럼 고정 7자 — 이름 중간 꺾임 방지)
  lines.push('{align:left}');
  lines.push('{width:* 7}');
  for (const item of order.lineItems) {
    const qtyPrefix = item.quantity !== '1' ? `${esc(item.quantity)} ` : '';
    lines.push(`"${qtyPrefix}${esc(item.name)}" | "${formatMoney(item.totalMoney)}"`);
    if (item.variationName) {
      lines.push(` ${esc(item.variationName)} |`);
    }
    for (const raw of item.modifiers ?? []) {
      const mod = normalizeMod(raw);
      const modQty = mod.qty > 1 ? `${mod.qty}x ` : '';
      const modPrice = mod.price > 0 ? formatMoney(mod.price * mod.qty) : '';
      lines.push(` ${modQty}${esc(mod.name)} | ${modPrice}`);
    }
    if (item.note) {
      lines.push(` '${esc(item.note)}' |`);
    }
  }
  lines.push('{width:auto}');
  lines.push('{align:center}');
  lines.push('----');

  // ── Totals ──
  lines.push('{align:left}');
  lines.push('{width:* 7}');
  if (order.subtotal != null) lines.push(`Subtotal | ${formatMoney(order.subtotal)}`);
  const tax = order.tax ?? order.taxAmount;
  if (tax != null) lines.push(`Tax | ${formatMoney(tax)}`);
  if (order.bagFee != null && order.bagFee > 0) lines.push(`Bag Fee | ${formatMoney(order.bagFee)}`);
  if (order.loyaltyDiscount != null && order.loyaltyDiscount > 0) {
    lines.push(`Points Discount | \\-${formatMoney(order.loyaltyDiscount)}`);
  }
  if (order.tipAmount != null && order.tipAmount > 0) lines.push(`Tip | ${formatMoney(order.tipAmount)}`);
  lines.push('{width:auto}'); // 확대(^) Total은 자동 폭이 필요
  lines.push(`^Total | ^${formatMoney(order.totalMoney)}`);
  lines.push('{align:center}');

  // ── Payment ──
  if (order.cardBrand || order.cardLast4 || order.paymentMethod) {
    const payment = order.paymentMethod === 'CASH'
      ? 'Cash'
      : [order.cardBrand, order.cardLast4 ? `**** ${order.cardLast4}` : ''].filter(Boolean).join(' ');
    if (payment) lines.push(`|${esc(payment)}|`);
  }
  // customerPhone: 인쇄 제외 (브라우저 티켓의 print:hidden과 동일)

  // ── Server alerts (⚠ CONFIRM — 약어 사용) ──
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
    lines.push('----');
    lines.push('{align:left}');
    lines.push('"!! CONFIRM:" |');
    for (const [label, count] of alertMap) {
      lines.push(`^${count} ${esc(label)} |`);
    }
    lines.push('{align:center}');
  }

  // ── Note / Delivery Note ──
  if (order.note) {
    lines.push('----');
    lines.push('{align:left}');
    lines.push(`"NOTE: ${esc(order.note)}" |`);
    lines.push('{align:center}');
  }
  if (order.deliveryNote) {
    lines.push('----');
    lines.push('{align:left}');
    lines.push(`"DELIVERY: ${esc(order.deliveryNote)}" |`);
    lines.push('{align:center}');
  }

  // ── Print provenance footer ──
  const now = opts.now ?? new Date();
  const printedAt = now.toLocaleTimeString('en-US', {
    timeZone: opts.timezone, hour: 'numeric', minute: '2-digit', hour12: true,
  });
  lines.push(`|Printed at ${esc(printedAt)} \\- ${opts.printSource}|`);

  return lines.join('\n');
}
