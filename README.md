# STRATEGY DESK — GitHub Actions 자동 모니터

DOGE-USDT 5분봉 기준으로 5분마다 Binance 데이터를 받아 16개 전략을 계산하고,
결과를 `results.json`에 저장합니다. `index.html`을 GitHub Pages로 켜두면
브라우저를 안 열어놔도, 컴퓨터를 꺼도 계속 갱신된 결과를 볼 수 있습니다.

## 설치 방법 (5단계, 약 10분)

### 1. 새 GitHub 저장소 만들기
- github.com 에서 **New repository** 클릭
- 이름은 아무거나 (예: `strategy-desk-monitor`)
- **Public**으로 만드는 것을 추천합니다. Public 저장소는 GitHub Actions 실행 시간이
  완전히 무료(무제한)입니다. Private로 하면 한 달에 2,000분 무료 한도가 있는데,
  5분마다 실행하면 한 달에 이 한도를 넘을 수 있습니다.

### 2. 이 폴더의 파일들을 그대로 업로드
아래 구조 그대로, 폴더 구조를 유지해서 업로드해주세요.
(저장소 페이지 → Add file → Upload files 로 드래그 앤 드롭 가능. 단, `.github` 폴더는
숨김 폴더 취급될 수 있어 웹 업로드로 안 될 경우 `git` 명령으로 올리거나,
GitHub Desktop 앱을 쓰는 것을 추천합니다.)

```
strategy-desk-monitor/
├── .github/
│   └── workflows/
│       └── monitor.yml
├── scripts/
│   └── run-strategies.mjs
├── index.html
└── results.json
```

### 3. Actions 쓰기 권한 켜기 (중요, 이거 안 하면 커밋이 실패합니다)
저장소 → **Settings** → **Actions** → **General** → 맨 아래
**Workflow permissions** → **Read and write permissions** 선택 → Save

### 4. GitHub Pages 켜기
저장소 → **Settings** → **Pages** → Source를 **Deploy from a branch** →
Branch: `main`, 폴더: `/ (root)` → Save

몇 분 후 `https://<사용자명>.github.io/<저장소이름>/` 주소에서 화면을 볼 수 있습니다.

### 5. 첫 실행 확인
저장소 → **Actions** 탭 → 왼쪽 **Strategy Desk Monitor** 클릭 →
**Run workflow** 버튼으로 한 번 수동 실행해보세요. 1~2분 안에 초록 체크가 뜨면 성공입니다.
이후로는 5분마다 자동으로 돌아갑니다.

## 종목/타임프레임 바꾸기
`.github/workflows/monitor.yml` 안의 이 부분을 수정하면 됩니다:

```yaml
env:
  SYMBOL: DOGEUSDT   # 예: BTCUSDT, ETHUSDT, SOLUSDT 등 Binance 선물 심볼
  INTERVAL: 5m       # 3m, 5m, 15m, 1h 중 선택 (너무 짧은 간격은 5분 스케줄과 안 맞음)
  CAPITAL: '10000'
```

## 알아두실 점 (한계)
- **GitHub 스케줄은 "정확히 5분마다"가 보장되지 않습니다.** 실제로는 몇 분 정도
  밀릴 수 있습니다 (GitHub 공식 안내사항입니다).
- **저장소에 60일간 커밋이 전혀 없으면** GitHub가 스케줄을 자동으로 꺼버립니다.
  이 워크플로우는 매번 결과를 커밋하기 때문에 정상 작동 중이면 이 문제는 없습니다.
- Public 저장소로 만들면 DOGE-USDT 전략 결과가 공개적으로 보입니다 (계좌 정보나
  개인정보는 전혀 없고 시세 분석 결과만 있어 대부분 문제없지만, 참고해주세요).
- 16개 전략 중 밸류·성장·퀄리티·배당·매크로·이벤트 6개는 코인에 실제 데이터가 없어
  합성 지표를 사용합니다 (기존 웹 버전과 동일한 한계).
