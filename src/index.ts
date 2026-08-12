import { loadConfig } from './config';
import { initLog, log } from './log';
import { StateStore } from './state';
import { Api } from './api';
import { PrintQueue } from './queue';
import { SocketBridge } from './socket';
import { Scanner } from './scanner';

async function main() {
  const config = loadConfig();
  initLog(config.dataDir, config.logLevel);
  log.info(`ziggl-print-agent starting — restaurant=${config.restaurantCode}, printer=${config.printerIp}:${config.printerPort}, cpl=${config.cpl}, server=${config.serverUrl}`);

  if (!config.enabled) {
    log.warn('config.enabled=false — agent idle (kill switch). Set enabled=true and restart to activate.');
    // 서비스 매니저가 크래시 루프로 오인하지 않도록 프로세스는 유지
    setInterval(() => {}, 1 << 30);
    return;
  }

  const state = new StateStore(config.dataDir);
  const api = new Api(config);

  // queue ↔ socket 상호 참조: 늦은 바인딩으로 해결
  let bridge: SocketBridge;
  const queue = new PrintQueue({
    config,
    api,
    state,
    resolveCached: (id) => bridge?.resolveCached(id),
    getTimezone: () => bridge?.getTimezone() ?? config.timezoneFallback,
    getMenu: () => bridge?.getMenu() ?? { menuItems: [], modifiers: [] },
  });
  bridge = new SocketBridge(config, api, state, queue);
  await bridge.start();

  // 시리얼(COM) 스캐너 — scanPort 설정 시에만 활성 (캐시어 포커스 무관 스캔)
  const scanner = new Scanner(config, api);
  scanner.start();

  const shutdown = (signal: string) => {
    log.info(`${signal} received — shutting down`);
    scanner.stop();
    queue.stop();
    bridge.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  // initLog 전 실패 가능성 — 콘솔에도 확실히
  // eslint-disable-next-line no-console
  console.error('[FATAL]', err.message);
  process.exit(1);
});
