import type { AgentConfig } from './config';
import type { Api } from './api';
import type { StateStore } from './state';
import type { KDSOrder, MenuDisplayConfig, PersistedJob, PrintSource } from './types';
import { buildTicketDoc } from './ticket';
import { renderStarGraphic } from './render';
import { sendToPrinter } from './printer';
import { log } from './log';

const RETRY_DELAYS_MS = [2_000, 8_000, 30_000];
const OUTAGE_TICK_MS = 60_000;

type JobResult =
  | { kind: 'printed' }
  | { kind: 'skip'; reason: string; markTag?: string }
  | { kind: 'retry_exhausted' };

interface QueueDeps {
  config: AgentConfig;
  api: Api;
  state: StateStore;
  /** socket 캐시(order:new + /active 스냅샷)에서 주문 해석 */
  resolveCached: (orderId: string) => KDSOrder | undefined;
  getTimezone: () => string;
  getMenu: () => MenuDisplayConfig;
}

export class PrintQueue {
  private jobs: PersistedJob[] = [];
  private processing = false;
  private ticker: NodeJS.Timeout | null = null;

  constructor(private deps: QueueDeps) {
    // 크래시/재시작 시 미완료 잡 복원
    this.jobs = [...deps.state.state.pendingJobs];
    if (this.jobs.length > 0) {
      log.info(`restored ${this.jobs.length} pending job(s) from state`);
      void this.process();
    }
    this.ticker = setInterval(() => {
      if (this.jobs.length > 0 && !this.processing) void this.process();
    }, OUTAGE_TICK_MS);
    this.ticker.unref?.();
  }

  stop() {
    if (this.ticker) clearInterval(this.ticker);
  }

  get pendingCount(): number {
    return this.jobs.length;
  }

  enqueue(orderId: string, source: PrintSource) {
    if (this.deps.state.isPrinted(orderId)) {
      log.debug(`skip enqueue ${orderId}: already printed`);
      return;
    }
    if (this.jobs.some((j) => j.orderId === orderId)) {
      log.debug(`skip enqueue ${orderId}: already queued`);
      return;
    }
    this.jobs.push({ orderId, enqueuedAt: new Date().toISOString(), source });
    this.persistJobs();
    log.info(`enqueued ${orderId} (${source}), queue=${this.jobs.length}`);
    void this.process();
  }

  dropIfUnprinted(orderId: string) {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((j) => j.orderId !== orderId);
    if (this.jobs.length !== before) {
      this.persistJobs();
      log.info(`dropped queued job for cancelled order ${orderId}`);
    }
  }

  private persistJobs() {
    this.deps.state.setPendingJobs(this.jobs);
  }

  private async process() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.jobs.length > 0) {
        const job = this.jobs[0];

        // 프린터 장기 다운 등으로 오래된 잡은 폐기 — 복구 시 뒤늦은 티켓 뭉치 방지
        const ageMin = (Date.now() - new Date(job.enqueuedAt).getTime()) / 60_000;
        if (ageMin > this.deps.config.maxTicketAgeMinutes) {
          log.error(`DROP stale job ${job.orderId} (${Math.round(ageMin)}min old > ${this.deps.config.maxTicketAgeMinutes}min)`);
          this.jobs.shift();
          this.persistJobs();
          continue;
        }

        const result = await this.printOne(job);
        if (result.kind === 'printed') {
          this.deps.state.markPrinted(job.orderId, job.source);
          this.jobs.shift();
          this.persistJobs();
        } else if (result.kind === 'skip') {
          log.info(`skip job ${job.orderId}: ${result.reason}`);
          if (result.markTag) this.deps.state.markPrinted(job.orderId, result.markTag);
          this.jobs.shift();
          this.persistJobs();
        } else {
          // 재시도 소진 — 잡 유지, 60초 티커가 다시 시도
          log.warn(`job ${job.orderId} kept in pending queue (printer unreachable?)`);
          break;
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /** 재시도 포함 1건 인쇄. 큐는 건드리지 않고 결과만 반환. */
  private async printOne(job: PersistedJob): Promise<JobResult> {
    const order = await this.resolveOrder(job.orderId);
    if (!order) {
      // 다른 레스토랑 주문(전역 브로드캐스트 방어) 또는 조회 불가
      return { kind: 'skip', reason: 'order not resolvable for this restaurant' };
    }
    if (order.status === 'CANCELED') {
      return { kind: 'skip', reason: 'order is CANCELED', markTag: 'skipped-canceled' };
    }

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const started = Date.now();
        const doc = buildTicketDoc(order, {
          timezone: this.deps.getTimezone(),
          serverUrl: this.deps.config.serverUrl,
          menu: this.deps.getMenu(),
          printSource: job.source,
        });
        const buffer = await renderStarGraphic(doc, this.deps.config.cpl);
        await sendToPrinter(buffer, this.deps.config.printerIp, this.deps.config.printerPort);
        log.info(`printed #${order.displayId} (${job.source}) in ${Date.now() - started}ms`);
        return { kind: 'printed' };
      } catch (err: any) {
        log.warn(`print attempt ${attempt + 1} failed for #${order.displayId}: ${err.message}`);
        if (attempt < RETRY_DELAYS_MS.length) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        }
      }
    }
    return { kind: 'retry_exhausted' };
  }

  private async resolveOrder(orderId: string): Promise<KDSOrder | null> {
    const cached = this.deps.resolveCached(orderId);
    if (cached) return cached;
    const fetched = await this.deps.api.fetchOrder(orderId);
    if (!fetched) return null;
    // 전역 브로드캐스트 방어 — 다른 레스토랑 주문이면 무시
    if (fetched.restaurantCode && fetched.restaurantCode !== this.deps.config.restaurantCode) {
      log.debug(`order ${orderId} belongs to ${fetched.restaurantCode}, not ${this.deps.config.restaurantCode} — ignoring`);
      return null;
    }
    return fetched.order;
  }
}
