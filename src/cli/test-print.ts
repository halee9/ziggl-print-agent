// npm run test-print [-- --ip 192.168.1.50 --port 9100] — 픽스처 티켓을 실물 프린터로 출력
import fs from 'node:fs';
import path from 'node:path';
import { buildTicketDoc } from '../ticket';
import { renderStarGraphic } from '../render';
import { sendToPrinter } from '../printer';
import type { KDSOrder } from '../types';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  let ip = arg('ip');
  let port = parseInt(arg('port') ?? '9100', 10);
  let cpl = parseInt(arg('cpl') ?? '36', 10);
  let threshold = parseInt(arg('threshold') ?? '200', 10);

  // config.json 있으면 기본값으로 사용
  const configPath = path.join(process.cwd(), 'config.json');
  if (fs.existsSync(configPath)) {
    const c = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    ip = ip || c.printerIp;
    port = arg('port') ? port : (c.printerPort ?? 9100);
    cpl = arg('cpl') ? cpl : (c.cpl ?? 36);
    threshold = arg('threshold') ? threshold : (c.threshold ?? 200);
  }
  if (!ip) {
    console.error('Usage: npm run test-print -- --ip <printer-ip> [--port 9100] [--cpl 36] [--threshold 200]');
    process.exit(1);
  }

  const order: KDSOrder = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../fixtures/sample-order.json'), 'utf-8')
  );

  const doc = buildTicketDoc(order, {
    timezone: 'America/Los_Angeles',
    serverUrl: 'https://api.ziggl.app',
    menu: {
      menuItems: [{ item_name: 'Garlic Spicy Combo', abbreviation: 'GS Combo', server_alert: true }],
      modifiers: [{ modifier_name: 'Extra Spicy Sauce', abbreviation: 'Ex Spicy', server_alert: true }],
    },
    printSource: 'test',
  });

  console.log(`rendering ticket (cpl=${cpl}, threshold=${threshold})...`);
  const buffer = await renderStarGraphic(doc, cpl, threshold);
  console.log(`sending ${buffer.length} bytes to ${ip}:${port}...`);
  await sendToPrinter(buffer, ip, port);
  console.log('OK — check the printer. QR should open the receipt page (test order → 404 is expected).');
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
