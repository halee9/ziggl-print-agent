// ziggl-pos/src/types.ts 부분 복사 — 티켓 렌더링에 필요한 필드만
export type OrderStatus = 'PENDING_PAYMENT' | 'OPEN' | 'IN_PROGRESS' | 'READY' | 'COMPLETED' | 'CANCELED';

export interface OrderModifier {
  name: string;
  qty: number;
  price: number; // cents
}

export interface OrderLineItem {
  name: string;
  quantity: string;
  variationName?: string;
  modifiers?: (OrderModifier | string)[];
  totalMoney: number; // cents
  note?: string;
}

export interface KDSOrder {
  id: string;
  displayId: string;
  source: string;
  status: OrderStatus;
  isDelivery: boolean;
  displayName: string;
  pickupAt: string;
  lineItems: OrderLineItem[];
  totalMoney: number; // cents
  paymentMethod?: string;
  note?: string;
  deliveryNote?: string;
  subtotal?: number;
  tax?: number;
  taxAmount?: number;
  tipAmount?: number;
  cardBrand?: string;
  cardLast4?: string;
  bagCount?: number;
  bagFee?: number;
  loyaltyDiscount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MenuDisplayItem {
  item_name: string;
  abbreviation?: string;
  server_alert?: boolean;
}

export interface ModifierDisplayItem {
  modifier_name: string;
  abbreviation?: string;
  server_alert?: boolean;
}

export interface MenuDisplayConfig {
  menuItems: MenuDisplayItem[];
  modifiers: ModifierDisplayItem[];
}

export type PrintSource = 'auto' | 'catchup' | 'manual' | 'test';

export interface PersistedJob {
  orderId: string;
  enqueuedAt: string; // ISO
  source: PrintSource;
}
