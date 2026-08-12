import type { AgentConfig } from './config';
import type { KDSOrder, MenuDisplayConfig } from './types';
import { log } from './log';

// ziggl-server supabaseClient.ts의 dbItemsToLineItems + dbOrderToKds 포팅 —
// GET /api/orders/:id/receipt 은 snake_case DB row를 그대로 반환하므로 필요
function dbItemsToLineItems(items: any[]): KDSOrder['lineItems'] {
  return (items ?? []).map((item) => ({
    name: item.name,
    quantity: String(item.quantity),
    variationName: item.variation_name ?? undefined,
    totalMoney: item.total_money,
    modifiers: item.modifiers ?? [],
    note: item.note || undefined,
  }));
}

export function normalizeDbOrder(row: any): KDSOrder {
  return {
    id: row.id,
    displayId: row.display_id,
    source: row.source,
    status: row.status,
    isDelivery: row.is_delivery,
    displayName: row.display_name,
    pickupAt: row.pickup_at,
    lineItems: dbItemsToLineItems(row.order_items ?? []),
    totalMoney: row.total_money,
    subtotal: row.subtotal,
    tax: row.tax_amount,
    taxAmount: row.tax_amount,
    tipAmount: row.tip_amount,
    paymentMethod: row.payment_method,
    cardBrand: row.card_brand,
    cardLast4: row.card_last4,
    note: row.note,
    deliveryNote: row.delivery_note,
    bagCount: row.bag_count ?? 0,
    bagFee: row.bag_fee ?? 0,
    loyaltyDiscount: row.loyalty_discount ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class Api {
  constructor(private config: AgentConfig) {}

  private async get(path: string): Promise<any> {
    const res = await fetch(`${this.config.serverUrl}${path}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return res.json();
  }

  private async send(method: string, path: string, body: any): Promise<number> {
    const res = await fetch(`${this.config.serverUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    return res.status;
  }

  /** 스캔으로 주문 상태 전환 (티켓 스캔 → READY/COMPLETED). 서버가 forward-only 검증. */
  async advanceStatus(orderId: string, status: 'READY' | 'COMPLETED'): Promise<number> {
    return this.send('PUT', `/api/orders/${orderId}/status`, {
      status,
      restaurantCode: this.config.restaurantCode,
    });
  }

  /** 스캐너 사용 로그 (scan_events 영구 저장 + railway [SCAN] 로그) */
  async logScan(station: string, kind: string, orderId: string): Promise<void> {
    try {
      await this.send('POST', '/api/orders/scan-log', {
        restaurantCode: this.config.restaurantCode,
        station,
        kind,
        orderId,
      });
    } catch {
      /* 로깅 실패는 무시 */
    }
  }

  /** 오늘자 주문 스냅샷 (KDS camelCase shape) */
  async fetchActiveOrders(): Promise<KDSOrder[]> {
    const data = await this.get(`/api/orders/${this.config.restaurantCode}/active`);
    return data.orders ?? [];
  }

  /** 개별 주문 (snake_case row → 정규화) + 소속 레스토랑 코드 반환 */
  async fetchOrder(orderId: string): Promise<{ order: KDSOrder; restaurantCode: string } | null> {
    try {
      const data = await this.get(`/api/orders/${orderId}/receipt`);
      if (!data?.order) return null;
      return {
        order: normalizeDbOrder(data.order),
        restaurantCode: String(data.order.restaurant_code ?? data.restaurant?.restaurant_code ?? '').toLowerCase(),
      };
    } catch (err: any) {
      log.warn(`fetchOrder(${orderId}) failed: ${err.message}`);
      return null;
    }
  }

  /** 서버알림 약어 설정 */
  async fetchMenuDisplay(): Promise<MenuDisplayConfig> {
    try {
      const data = await this.get(`/api/menu-display/${this.config.restaurantCode}`);
      return { menuItems: data.menuItems ?? [], modifiers: data.modifiers ?? [] };
    } catch (err: any) {
      log.warn(`fetchMenuDisplay failed: ${err.message} — server alerts will use full names`);
      return { menuItems: [], modifiers: [] };
    }
  }

  /** 레스토랑 timezone (시각 표기용) */
  async fetchTimezone(): Promise<string> {
    try {
      const data = await this.get(`/api/config/${this.config.restaurantCode.toUpperCase()}`);
      return data.timezone || this.config.timezoneFallback;
    } catch (err: any) {
      log.warn(`fetchTimezone failed: ${err.message} — using ${this.config.timezoneFallback}`);
      return this.config.timezoneFallback;
    }
  }
}
