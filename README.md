# ziggl-print-agent

주방 오더 티켓을 **Star TSP100 LAN 프린터**(TCP 9100, 래스터)로 직접 출력하는 상시 실행 에이전트.
브라우저(Firefox) silent printing을 대체한다 — 브라우저 탭·OS 프린터 설정 의존 없음, 실패 시 자동 재시도, 재시작 시 놓친 주문 캐치업.

```
ziggl-server (Socket.io) ──order:updated(IN_PROGRESS)──▶ agent ──raster──▶ TSP100 (TCP 9100)
```

- 티켓 렌더링: [receiptline](https://www.npmjs.com/package/receiptline) 마크업 → SVG → PNG(sharp) → Star Graphic Mode
- 레이아웃은 POS의 `OrderTicketModal.tsx` TicketContent와 동일 (QR·서버알림 CONFIRM 블록 포함)
- POS의 수동 프린트(프린터 아이콘)는 그대로 폴백으로 사용 가능

## 설치 (Windows POS 머신)

1. **사전 준비**
   - Node.js 20 LTS 설치 (https://nodejs.org)
   - 프린터를 LAN에 연결하고 라우터에서 **DHCP 예약(고정 IP)** 설정. `ping <프린터IP>`로 확인.
2. **에이전트 설치**
   ```
   git clone https://github.com/halee9/ziggl-print-agent C:\ziggl-print-agent
   cd C:\ziggl-print-agent
   npm ci
   npm run build
   copy config.example.json config.json
   notepad config.json   ← printerIp, restaurantCode 입력
   ```
3. **프린터 검증** (실물 출력)
   ```
   npm run test-print
   ```
   샘플 티켓이 출력되고 잘림(컷)까지 정상인지, QR이 폰으로 스캔되는지 확인.
4. **Windows 서비스 등록** — [NSSM](https://nssm.cc/download) 사용 (부팅 시 자동 시작 + 크래시 자동 재시작)
   ```
   nssm install ZigglPrintAgent "C:\Program Files\nodejs\node.exe" "C:\ziggl-print-agent\dist\index.js"
   nssm set ZigglPrintAgent AppDirectory "C:\ziggl-print-agent"
   nssm set ZigglPrintAgent AppStdout "C:\ziggl-print-agent\data\logs\service-out.log"
   nssm set ZigglPrintAgent AppStderr "C:\ziggl-print-agent\data\logs\service-err.log"
   nssm set ZigglPrintAgent AppRestartDelay 5000
   nssm start ZigglPrintAgent
   ```
   재부팅 후 자동 시작되는지 확인.
5. **커토버**
   - 병행 운전: POS의 Auto Print를 켜둔 채 하루 운영 → 주문마다 티켓 2장(브라우저+에이전트) 나오면 정상.
   - 안정 확인 후 POS Settings에서 **Auto Print 토글 OFF** → 에이전트가 유일한 자동 출력 경로.
   - 롤백: Auto Print 토글 다시 ON.

## config.json

| 키 | 설명 | 기본 |
|---|---|---|
| `serverUrl` | ziggl-server 주소 | `https://api.ziggl.app` |
| `restaurantCode` | 레스토랑 코드 | — |
| `printerIp` / `printerPort` | 프린터 주소 | — / `9100` |
| `cpl` | 줄당 글자수 (80mm=48) | `48` |
| `enabled` | `false`면 대기만 (킬 스위치) | `true` |
| `maxTicketAgeMinutes` | 이 시간보다 오래 밀린 잡은 폐기 | `30` |
| `logLevel` | `debug`/`info`/`warn`/`error` | `info` |

## 동작 방식

- `order:updated`에서 `status=IN_PROGRESS`를 받으면 큐에 넣고 순서대로 인쇄.
- **중복 방지**: 인쇄한 주문 ID를 `data/state.json`에 영속 — 재시작해도 같은 티켓이 다시 나오지 않음.
- **캐치업**: (재)연결 때마다 오늘 주문을 조회해, 에이전트가 꺼져 있는 동안 IN_PROGRESS가 된 주문만 늦게라도 인쇄. 이미 READY/COMPLETED로 넘어간 주문은 인쇄하지 않음(주방이 이미 처리).
- **최초 실행**: 기존 주문 전부를 "인쇄된 것"으로 마킹만 함 — 설치 직후 티켓 폭풍 방지.
- **재시도**: 잡당 3회(2s/8s/30s) → 실패 시 보류 큐에 영속 보관, 60초마다 재시도. 30분 넘게 밀린 잡은 폐기(복구 시 뒤늦은 티켓 뭉치 방지).

## 운영 / 장애 대응

- 로그: `data/logs/agent-YYYY-MM-DD.log` (14일 보관)
- 티켓이 안 나올 때 체크 순서:
  1. 프린터 전원/용지 LED → 2. `ping <프린터IP>` → 3. 로그에서 `print attempt … failed` / `socket disconnected` 확인
- 급한 주문은 POS 프린터 아이콘으로 수동 출력 (브라우저 경로, 에이전트와 무관)
- 일시 정지: `nssm stop ZigglPrintAgent` (또는 config `enabled: false` 후 재시작)
- **한계(v1)**: 용지 없음/커버 열림은 감지하지 못함 (TCP 전송은 성공으로 처리됨). 영업 시작 전 `npm run test-print` 한 번을 권장.

## 개발

```
npm run dev        # 에이전트 실행 (tsx)
npm test           # vitest
npm run preview    # 샘플 티켓 → data/ticket.svg (레이아웃 확인)
npm run test-print -- --ip 192.168.1.50   # 실물 출력 테스트
```
