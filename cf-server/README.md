# 실시간 대결 서버 (Cloudflare Workers)

야구선수훈련게임의 실시간 대결·랭킹을 담당하는 서버입니다.

## 왜 Cloudflare인가

| | Render 무료 | **Cloudflare 무료** |
|---|---|---|
| 잠드는가 | 15분 무접속 시 잠듦 (깨는 데 약 1분) | **안 잠듦** |
| 랭킹 보존 | 불가 (영구 디스크 없음) | **가능** (5GB 저장소) |
| 하루 한도 | 월 750시간 | 요청 10만 건 / DO 13,000 GB-s |

WebSocket 수신 메시지는 20건을 1요청으로 계산하므로, 몇 명이 즐기는 수준에서는 한도에 닿지 않습니다.

## 구조

```
src/index.js   접속·매칭·경기진행·랭킹 (Durable Object)
src/game.js    야구 규칙 계산 (게임 화면과 동일한 규칙)
wrangler.toml  Cloudflare 설정
```

**Durable Object를 쓰는 이유**: 일반 Workers는 요청마다 따로 실행되어 "지금 누가 기다리는지"를 기억하지 못합니다. Durable Object는 하나의 방처럼 계속 유지되어 매칭·경기·랭킹을 한곳에서 처리할 수 있습니다.

## 실행

```bash
npm install
npm run dev      # 로컬 테스트 (http://127.0.0.1:8787)
npm run deploy   # Cloudflare에 배포
```

## 주소

| 주소 | 용도 |
|---|---|
| `wss://<배포주소>` | 게임이 접속하는 곳 |
| `https://<배포주소>/health` | 서버가 살아있는지 확인 |
| `https://<배포주소>/ranking` | 랭킹을 웹으로 바로 보기 |

## 주고받는 메시지

**게임 → 서버**: `join` `pitch` `swing_result` `ranking` `leave`
**서버 → 게임**: `queued` `matched` `atbat_pending` `pitch_thrown` `atbat_result` `game_over` `ranking` `opponent_left` `error`

## 설정값

`wrangler.toml`의 `AB_DELAY` — 한 타석이 끝나고 다음 타자로 넘어가기까지의 간격(밀리초, 기본 900).
