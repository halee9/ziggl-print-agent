import { io, type Socket } from 'socket.io-client';
import type { AgentConfig } from './config';
import type { Api } from './api';
import type { StateStore } from './state';
import type { PrintQueue } from './queue';
import type { KDSOrder, MenuDisplayConfig } from './types';
import { log } from './log';

const ORDER_CACHE_MAX = 300;

export class SocketBridge {
  private socket: Socket;
  /** order:new + /active 스냅샷 캐시 (queue의 주문 해석용) */
  private orderCache = new Map<string, KDSOrder>();
  private menu: MenuDisplayConfig = { menuItems: [], modifiers: [] };
  private timezone: string;

  constructor(
    private config: AgentConfig,
    private api: Api,
    private state: StateStore,
    private queue: PrintQueue,
  ) {
    this.timezone = config.timezoneFallback;
    this.socket = io(config.serverUrl, {
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
      timeout: 10_000,
    });
    this.wire();
  }

  getTimezone = () => this.timezone;
  getMenu = () => this.menu;
  resolveCached = (orderId: string) => this.orderCache.get(orderId);

  async start() {
    this.timezone = await this.api.fetchTimezone();
    this.menu = await this.api.fetchMenuDisplay();
    log.info(`timezone=${this.timezone}, menu-display: ${this.menu.menuItems.length} items / ${this.menu.modifiers.length} modifiers`);
    // 10분마다 메뉴 표시 설정 리프레시 (이벤트 누락 대비)
    const menuTick = setInterval(() => void this.refreshMenu(), 10 * 60_000);
    menuTick.unref?.();
  }

  stop() {
    this.socket.disconnect();
  }

  private async refreshMenu() {
    this.menu = await this.api.fetchMenuDisplay();
  }

  private cacheOrder(order: KDSOrder) {
    this.orderCache.set(order.id, order);
    if (this.orderCache.size > ORDER_CACHE_MAX) {
      // 가장 오래된 것부터 제거 (Map은 삽입 순서 유지)
      const first = this.orderCache.keys().next().value;
      if (first) this.orderCache.delete(first);
    }
  }

  private wire() {
    this.socket.on('connect', () => {
      log.info(`socket connected (${this.socket.id}) — joining ${this.config.restaurantCode}`);
      this.socket.emit('join', this.config.restaurantCode);
      // 프린터 전용 room — 서버의 수동 재출력 릴레이가 에이전트 온라인 판단에 사용.
      // 테스트/관찰용 에이전트(acceptManualPrints=false)는 join하지 않음 —
      // room에 있으면 매장 POS의 재출력을 가로채고 폴백도 막아버림
      if (this.config.acceptManualPrints) {
        this.socket.emit('join-printer', this.config.restaurantCode);
      }
      void this.catchUp();
    });

    // POS 프린터 아이콘 → 서버 릴레이 → 수동 재출력 (이미 인쇄한 주문도 다시 인쇄)
    this.socket.on('print:request', (payload: { orderId?: string }) => {
      if (!payload?.orderId) return;
      log.info(`print:request received for ${payload.orderId}`);
      this.queue.enqueue(payload.orderId, 'manual', { force: true });
    });

    this.socket.on('disconnect', (reason) => {
      log.warn(`socket disconnected: ${reason}`);
    });

    this.socket.on('order:new', (order: KDSOrder) => {
      // 새 주문은 OPEN/PENDING — 인쇄하지 않고 캐시만 (IN_PROGRESS 전환 때 씀)
      if (order?.id) {
        this.cacheOrder(order);
        log.debug(`order:new cached ${order.id} (#${order.displayId}, ${order.status})`);
      }
    });

    this.socket.on('order:updated', (payload: { id?: string; status?: string }) => {
      if (!payload?.id) return;
      if (!payload.status) return; // meta-only emit (note/flag/photos/card) — 무시
      const cached = this.orderCache.get(payload.id);
      if (cached) cached.status = payload.status as KDSOrder['status'];
      if (payload.status === 'IN_PROGRESS') {
        this.queue.enqueue(payload.id, 'auto');
      }
    });

    this.socket.on('order:cancelled', (payload: { id?: string }) => {
      if (!payload?.id) return;
      const cached = this.orderCache.get(payload.id);
      if (cached) cached.status = 'CANCELED';
      this.queue.dropIfUnprinted(payload.id);
    });

    this.socket.on('menu-display:updated', () => {
      log.debug('menu-display:updated — refreshing');
      void this.refreshMenu();
    });
  }

  /**
   * (재)연결 시 캐치업 — POS autoPrintInitRef/캐치업 로직의 영속 버전.
   * 최초 실행: 기존 주문 전부 마킹만 (프린트 폭풍 방지).
   * 이후: 놓친 IN_PROGRESS만 인쇄, 이미 진행 지난 주문(READY 이상)은 조용히 마킹.
   */
  private async catchUp() {
    let orders: KDSOrder[];
    try {
      orders = await this.api.fetchActiveOrders();
    } catch (err: any) {
      log.warn(`catch-up fetch failed: ${err.message} — will retry on next reconnect`);
      return;
    }
    for (const o of orders) this.cacheOrder(o);

    if (!this.state.state.initialized) {
      let marked = 0;
      for (const o of orders) {
        if (['IN_PROGRESS', 'READY', 'COMPLETED', 'CANCELED'].includes(o.status) && !this.state.isPrinted(o.id)) {
          this.state.markPrinted(o.id, 'init-marked');
          marked++;
        }
      }
      this.state.setInitialized();
      log.info(`first run: init guard marked ${marked} existing order(s) without printing`);
      return;
    }

    let printed = 0, already = 0, skipped = 0;
    for (const o of orders) {
      if (this.state.isPrinted(o.id)) {
        already++;
        continue;
      }
      if (o.status === 'IN_PROGRESS') {
        this.queue.enqueue(o.id, 'catchup');
        printed++;
      } else if (['READY', 'COMPLETED', 'CANCELED'].includes(o.status)) {
        // 에이전트 다운 중 이미 처리된 주문 — 지금 인쇄하면 소음
        this.state.markPrinted(o.id, `skipped-${o.status}`);
        skipped++;
      }
    }
    log.info(`catch-up: ${printed} to print, ${already} already-printed, ${skipped} marked-skipped (of ${orders.length} active)`);
  }
}
