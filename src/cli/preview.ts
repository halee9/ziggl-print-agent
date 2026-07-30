// npm run preview — 픽스처 주문을 SVG로 렌더해 data/ticket.svg 저장 (육안 검증용)
import fs from 'node:fs';
import path from 'node:path';
import { buildTicketDoc } from '../ticket';
import { renderSvg, renderTicketPng } from '../render';
import type { KDSOrder } from '../types';

async function main() {
  const fixturePath = process.argv[2] || path.join(__dirname, '../../fixtures/sample-order.json');
  const order: KDSOrder = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

  const doc = buildTicketDoc(order, {
    timezone: 'America/Los_Angeles',
    serverUrl: 'https://api.ziggl.app',
    menu: {
      menuItems: [{ item_name: 'Garlic Spicy Combo', abbreviation: 'GS Combo', server_alert: true }],
      modifiers: [{ modifier_name: 'Extra Spicy Sauce', abbreviation: 'Ex Spicy', server_alert: true }],
    },
    printSource: 'test',
  });

  console.log('── receiptline doc ──\n' + doc + '\n──────────────────────');
  const cpl = parseInt(process.env.PREVIEW_CPL ?? '36', 10);
  const outDir = path.join(__dirname, '../../data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'ticket.svg'), await renderSvg(doc, cpl));
  // 실제 인쇄와 동일한 파이프라인의 PNG (threshold 이진화 포함)
  fs.writeFileSync(path.join(outDir, 'ticket.png'), await renderTicketPng(doc, cpl, 200));
  console.log(`wrote ${outDir}/ticket.svg and ticket.png (cpl=${cpl})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
