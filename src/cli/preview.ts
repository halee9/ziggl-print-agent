// npm run preview — 픽스처 주문을 SVG로 렌더해 data/ticket.svg 저장 (육안 검증용)
import fs from 'node:fs';
import path from 'node:path';
import { buildTicketDoc, buildTicketParts } from '../ticket';
import { renderTicketPng } from '../render';
import type { KDSOrder } from '../types';

async function main() {
  const fixturePath = process.argv[2] || path.join(__dirname, '../../fixtures/sample-order.json');
  const order: KDSOrder = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

  const opts = {
    timezone: 'America/Los_Angeles',
    serverUrl: 'https://api.ziggl.app',
    menu: {
      menuItems: [{ item_name: 'Garlic Spicy Combo', abbreviation: 'GS Combo', server_alert: true }],
      modifiers: [{ modifier_name: 'Extra Spicy Sauce', abbreviation: 'Ex Spicy', server_alert: true }],
    },
    printSource: 'test' as const,
  };

  console.log('── receiptline doc ──\n' + buildTicketDoc(order, opts) + '\n──────────────────────');
  const cpl = parseInt(process.env.PREVIEW_CPL ?? '30', 10);
  const outDir = path.join(__dirname, '../../data');
  fs.mkdirSync(outDir, { recursive: true });
  // 실제 인쇄와 동일한 파이프라인의 PNG (패널 합성 + threshold 이진화 포함)
  const fontFamily = process.env.PREVIEW_FONT || undefined;
  fs.writeFileSync(path.join(outDir, 'ticket.png'), await renderTicketPng(buildTicketParts(order, opts), cpl, 200, fontFamily));
  console.log(`wrote ${outDir}/ticket.png (cpl=${cpl}, font=${fontFamily ?? 'default'})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
