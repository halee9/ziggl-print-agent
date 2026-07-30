# ziggl-print-agent

주방 오더 티켓을 **Star TSP100 LAN 프린터**(TCP 9100, 래스터)로 직접 출력하는 상시 실행 에이전트.
브라우저(Firefox) silent printing을 대체한다 — 브라우저 탭·OS 프린터 설정 의존 없음, 실패 시 자동 재시도, 재시작 시 놓친 주문 캐치업, POS 수동 재출력 릴레이 수신.

```
ziggl-server ──order:updated(IN_PROGRESS)──▶ agent ──raster──▶ Star TSP100 (TCP 9100)
     └───────print:request(수동 재출력)──────▶
```

- 티켓 렌더링: receiptline 마크업 → SVG → PNG(sharp) → Star Graphic Mode
- 레이아웃·폰트 크기는 기존 브라우저 티켓과 동일하게 조정됨 (Consolas, 042 zero-pad 번호+QR 좌우 배치, 옵션 들여쓰기 등)
- DB 직접 접근 없음 — POS와 같은 서버 API·Socket.io만 사용

---

## 매장 주방 PC 설치 (전체 순서)

### 0. 사전 준비

- **프린터**: Star TSP100 LAN을 랜선으로 공유기에 연결.
  - 프린터 IP 확인: 프린터 전원을 끄고 → **피드(FEED) 버튼을 누른 채 전원 켜기** → 셀프테스트 용지에 IP 주소가 인쇄됨.
  - 라우터 관리 화면에서 그 IP를 **DHCP 예약(고정)** 해두기 (안 하면 언젠가 IP가 바뀌어 인쇄가 멈춤).
  - PC에서 `ping <프린터IP>` 로 연결 확인.
- **Node.js 22 LTS** 설치: https://nodejs.org → Windows Installer(.msi) → 설치 후 **cmd 창을 새로 열고** `node -v` 가 v22 이상인지 확인.
  - ⚠️ 구버전 Node(v12 등)가 깔려 있으면 `npm ci`에서 "cannot read ... of undefined" 같은 알 수 없는 에러가 남. 반드시 새 버전 설치 + 새 창.
- **Git** 설치: https://git-scm.com/download/win (기본 옵션으로 Next 연타)

### 1. 다운로드 & 빌드

```bat
git clone https://github.com/halee9/ziggl-print-agent C:\ziggl-print-agent
cd C:\ziggl-print-agent
npm ci        (에러 나면 npm install 로 대체)
npm run build
```

### 2. 설정

```bat
copy config.example.json config.json
notepad config.json
```

```jsonc
{
  "serverUrl": "https://api.ziggl.app",
  "restaurantCode": "midori",
  "printerIp": "192.168.0.114",      // ← 0단계에서 확인한 실제 프린터 IP로 수정
  "printerPort": 9100,
  "cpl": 32,                          // 글자 크기 배율 (작을수록 큼: 28~36)
  "threshold": 200,                   // 인쇄 농도 (흐리면 220으로)
  "fontFamily": "Consolas",
  "acceptManualPrints": true,         // 매장 본기기 = true (아래 '여러 대 운영' 참고)
  "enabled": true,
  "timezoneFallback": "America/Los_Angeles",
  "maxTicketAgeMinutes": 30,
  "logLevel": "info"
}
```

### 3. 실물 출력 테스트

```bat
npm run test-print
```

샘플 티켓이 나오면 확인: 글자 선명한가 / 자동 컷 되는가 / QR이 폰으로 스캔되는가(테스트 주문이라 404 페이지 정상).

### 4. Windows 서비스 등록 (NSSM)

부팅 시 자동 시작 + 크래시 자동 재시작. cmd 창을 닫아도, 재부팅해도, 로그아웃해도 계속 돈다.

1. https://nssm.cc/download → zip 다운로드 → 압축 풀고 `win64\nssm.exe` 하나만 `C:\ziggl-print-agent\` 에 복사
2. **관리자 권한 cmd** (시작 → "cmd" 검색 → 우클릭 → 관리자 권한으로 실행):

```bat
cd C:\ziggl-print-agent
nssm install ZigglPrintAgent "C:\Program Files\nodejs\node.exe" "C:\ziggl-print-agent\dist\index.js"
nssm set ZigglPrintAgent AppDirectory "C:\ziggl-print-agent"
nssm set ZigglPrintAgent AppStdout "C:\ziggl-print-agent\data\logs\service-out.log"
nssm set ZigglPrintAgent AppStderr "C:\ziggl-print-agent\data\logs\service-err.log"
nssm set ZigglPrintAgent AppRestartDelay 5000
nssm start ZigglPrintAgent
```

3. 가동 확인:

```bat
type data\logs\service-out.log
```

`socket connected … joining midori` 가 보이면 정상. 최초 실행이면 `first run: init guard marked N existing order(s)` 도 보임 (기존 주문 마킹 — 티켓 폭탄 방지, 정상).

4. **재부팅 테스트**: PC 재부팅 → 로그인 없이도 서비스가 자동 시작되는지 로그로 확인.

5. **전원 설정**: 제어판 → 전원 옵션 → 절전 모드 **해제 안 함**. (절전되면 그동안 인쇄 스킵)

### 5. 병행 운전 → 커토버

1. 등록 직후는 **POS의 Auto Print 토글을 켜둔 채** 운영 → 주문마다 티켓 2장(Epson + Star)이 나오는 게 정상. 하루 정도 내용·누락 비교.
2. 안정 확인되면 POS Settings → **Auto Print OFF** → 이후 자동 인쇄는 Star(에이전트)만.
3. POS의 수동 프린트 아이콘은 자동으로 에이전트(Star)로 감. 에이전트가 죽어 있으면 저절로 브라우저(Epson) 인쇄로 폴백되므로 Epson은 비상용으로 연결만 유지 권장.

---

## 서비스 관리 명령 (관리자 cmd)

| 작업 | 명령 |
|---|---|
| 중지 / 시작 / 재시작 | `nssm stop ZigglPrintAgent` / `nssm start …` / `nssm restart ZigglPrintAgent` |
| 상태 확인 | `nssm status ZigglPrintAgent` |
| 서비스 제거 | `nssm remove ZigglPrintAgent confirm` |
| 업데이트 | `cd C:\ziggl-print-agent && git pull && npm run build && nssm restart ZigglPrintAgent` |
| 설정 변경 후 | config.json 수정 → `nssm restart ZigglPrintAgent` |

## 장애 시 체크리스트 (티켓이 안 나올 때)

1. 프린터 전원·용지 LED 확인
2. `ping <프린터IP>` — 안 되면 랜선/공유기/IP 변경 여부 (DHCP 예약 확인)
3. `nssm status ZigglPrintAgent` — STOPPED면 `nssm start`
4. 로그 확인: `data\logs\agent-YYYY-MM-DD.log`
   - `print attempt … failed` → 프린터 연결 문제
   - `socket disconnected` 반복 → 인터넷 문제
5. **급한 주문은 POS 프린터 아이콘** — 에이전트가 죽어 있으면 자동으로 브라우저 인쇄로 폴백됨
6. 영업 중 급하면 에이전트를 끄고(POS Settings에서 Auto Print ON) 기존 방식으로 롤백

## 여러 대 운영 (집 테스트 등)

- 에이전트는 어디서 실행하든 서버에 붙어 자동 인쇄를 수행함 — 여러 대면 각자 자기 프린터로 인쇄 (관찰·백업용으로 유용).
- 단, **수동 재출력(`acceptManualPrints`)은 매장 본기기만 true** 로 둘 것.
  집/테스트 에이전트가 true면 매장 직원의 재출력 버튼이 그 프린터로 가버리고 브라우저 폴백도 막힘.

## 동작 원리 요약

- `order:updated`에서 `IN_PROGRESS` 전환 감지 → 큐 → 렌더 → TCP 9100 전송
- 인쇄 이력은 `data/state.json`에 영속 — 재시작해도 중복 인쇄 없음
- (재)연결 때마다 오늘 주문 캐치업: 꺼져 있는 동안 IN_PROGRESS 된 주문만 늦게라도 인쇄, 이미 READY/완료된 주문은 건너뜀
- 실패 시 잡당 3회(2s/8s/30s) + 60초 주기 재시도, 30분 초과 잡은 폐기
- 한계(v1): 용지 없음/커버 열림은 감지 못함 → 영업 시작 전 `npm run test-print` 한 번 권장

## 개발

```bat
npm run dev        에이전트 실행 (소스에서 바로, 빌드 불필요 — 창 닫으면 죽음)
npm test           단위 테스트
npm run preview    샘플 티켓 → data/ticket.png (레이아웃 확인)
npm run test-print -- --ip 192.168.0.114 --cpl 32 --font "Consolas"
```
