// npm run preview — 픽스처 주문을 SVG로 렌더해 data/ticket.svg 저장 (육안 검증용)
import fs from 'node:fs';
import path from 'node:path';
import { buildTicketDoc } from '../ticket';
import { renderSvg } from '../render';
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
  const svg = await renderSvg(doc, 48);
  const out = path.join(__dirname, '../../data/ticket.svg');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, svg);
  console.log(`wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
