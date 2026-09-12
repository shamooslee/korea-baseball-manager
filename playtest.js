/* 실제 브라우저로 게임을 처음부터 끝까지 플레이해보며 오류를 찾는다. */
const { chromium } = require('playwright');
const path = require('path');

const GAME = 'file://' + path.join(__dirname, 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });

  const errors = [];
  const logs = [];
  page.on('console', m => {
    const t = m.type();
    if (t === 'error' || t === 'warning') errors.push(`[${t}] ${m.text()}`);
    logs.push(`[${t}] ${m.text()}`);
  });
  page.on('pageerror', e => errors.push(`[페이지오류] ${e.message}\n    ${(e.stack || '').split('\n')[1] || ''}`));

  const step = async (name, fn) => {
    const before = errors.length;
    /* 앞 단계에서 열린 안내창이 남아 있으면 닫고 시작한다 */
    try {
      if (await page.evaluate(() => !!state.modal)) {
        await page.evaluate(() => closeModal());
        await page.waitForTimeout(150);
      }
    } catch (e) { /* 무시 */ }
    try { await fn(); }
    catch (e) { errors.push(`[${name} 실행실패] ${e.message}`); }
    const newErrs = errors.slice(before);
    console.log(`${newErrs.length ? '❌' : '✅'} ${name}${newErrs.length ? '\n   ' + newErrs.join('\n   ') : ''}`);
  };

  /* 화면에 보이는 글자로 '누를 수 있는 것'을 찾는다.
     설명 문구가 아니라 버튼·카드를 집도록 우선순위를 둔다. */
  const clickText = async (txt, opts = {}) => {
    const candidates = [
      `button:has-text("${txt}")`,
      `.menuItem:has-text("${txt}")`,
      `.teamCard:has-text("${txt}")`,
      `[onclick]:has-text("${txt}")`,
      `text=${txt}`
    ];
    for (const sel of candidates) {
      const el = page.locator(sel).first();
      if (await el.count() && await el.isVisible().catch(() => false)) {
        await el.click();
        await page.waitForTimeout(opts.wait || 250);
        return;
      }
    }
    throw new Error(`'${txt}' 를 누를 수 있는 곳을 못 찾음`);
  };
  const screen = () => page.evaluate(() => state.screen);
  const peek = (expr) => page.evaluate(expr);

  /* three.js를 인터넷에서 못 받는 환경이므로, 요청이 오면 로컬 파일로 대신 응답한다
     (실제 사용자 환경과 똑같이 3D가 켜진 상태를 재현하기 위함) */
  if (process.env.WITH_3D === '1') {
    const three = require('fs').readFileSync(path.join(__dirname, 'node_modules/three/build/three.min.js'), 'utf8');
    await page.route('**/three.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: three }));
  }

  await page.goto(GAME);
  await page.waitForTimeout(1500);

  console.log('\n===== 게임 플레이 시작 =====\n');

  await step('게임이 열리는가', async () => {
    const title = await page.title();
    if (title !== 'Korea Baseball Manager') throw new Error('제목이 다름: ' + title);
    if (await screen() !== 'login') throw new Error('로그인 화면이 아님: ' + await screen());
  });

  await step('로그인', async () => {
    await page.fill('#loginInput', '광훈');
    await clickText('로그인');
    if (await screen() !== 'teamselect') throw new Error('팀선택으로 안 감: ' + await screen());
  });

  await step('팀 선택 (광주 백호)', async () => {
    await clickText('광주 백호', { wait: 600 });
    if (await screen() !== 'home') throw new Error('홈으로 안 감: ' + await screen());
    const n = await peek(() => state.roster.batters.length + state.roster.pitchers.length);
    if (n < 17) throw new Error('선수가 부족: ' + n);
  });

  await step('홈 화면에 전적 카드가 보이는가', async () => {
    const txt = await page.textContent('#app');
    if (!txt.includes('실시간 대결 전적')) throw new Error('전적 카드 없음');
    if (!txt.includes('자동 저장')) throw new Error('저장 안내 없음');
  });

  await step('라인업 화면', async () => {
    await clickText('라인업 설정');
    if (await screen() !== 'lineup') throw new Error('화면 전환 실패');
    const txt = await page.textContent('#app');
    if (!txt.includes('오늘의 컨디션')) throw new Error('컨디션 안내 없음');
  });

  await step('타순 선수 교체', async () => {
    await page.locator('.lineupRow').first().click();
    await page.waitForTimeout(300);
    const hasModal = await peek(() => !!state.modal);
    if (!hasModal) throw new Error('선수 선택창이 안 뜸');
    await page.locator('.modalBox .btn.small').first().click();
    await page.waitForTimeout(300);
    if (await peek(() => !!state.modal)) throw new Error('창이 안 닫힘');
  });

  await step('선발투수 교체', async () => {
    await page.evaluate(() => openPitcherPicker());
    await page.waitForTimeout(300);
    await page.locator('.modalBox .btn.small').first().click();
    await page.waitForTimeout(300);
    if (await peek(() => !!state.modal)) throw new Error('창이 안 닫힘');
  });

  await step('선수 육성 화면', async () => {
    await page.evaluate(() => goto('home'));
    await clickText('선수 육성');
    if (await screen() !== 'roster') throw new Error('화면 전환 실패');
  });

  await step('선수 상세 열기', async () => {
    await page.locator('.pickCard').first().click();
    await page.waitForTimeout(300);
    if (await screen() !== 'playerdetail') throw new Error('상세 화면이 안 열림');
    const txt = await page.textContent('#app');
    for (const k of ['오늘의 컨디션', '시즌 기록', '훈련', '합성']) {
      if (!txt.includes(k)) throw new Error(k + ' 항목 없음');
    }
  });

  await step('훈련 (코인 충분할 때)', async () => {
    await page.evaluate(() => { state.coins = 99999; render(); });
    const before = await peek(() => { const p = findPlayer(state.detail.id, state.detail.ptype); return statKeys(p).reduce((s, k) => s + p[k], 0); });
    await page.locator('.lineupRow .btn.small').first().click();
    await page.waitForTimeout(300);
    const after = await peek(() => { const p = findPlayer(state.detail.id, state.detail.ptype); return statKeys(p).reduce((s, k) => s + p[k], 0); });
    if (after !== before + 1) throw new Error(`능력치가 안 올랐음 (${before} → ${after})`);
  });

  await step('코인 0일 때 훈련하면 안내가 뜨는가', async () => {
    await page.evaluate(() => { state.coins = 0; render(); });
    await page.locator('.lineupRow .btn.small').first().click();
    await page.waitForTimeout(300);
    const m = await peek(() => state.modal && state.modal.type);
    if (m !== 'info') throw new Error('안내창이 안 뜸');
    await page.evaluate(() => closeModal());
    await page.evaluate(() => { state.coins = 500; render(); });
  });

  await step('합성 화면', async () => {
    await page.evaluate(() => { const p = state.roster.batters.find(b => state.lineup.indexOf(b.id) === -1); openPlayerDetail(p.id, 'batter'); });
    await page.waitForTimeout(300);
    await clickText('재료 선수 고르기');
    if (await screen() !== 'fuse') throw new Error('합성 화면이 안 열림');
  });

  await step('합성 실행', async () => {
    const cnt = await peek(() => state.roster.batters.length);
    await page.locator('.card .pickCard').first().click();
    await page.waitForTimeout(200);
    await clickText('명으로 합성하기', { wait: 500 });
    await page.evaluate(() => closeModal());
    const after = await peek(() => state.roster.batters.length);
    if (after !== cnt - 1) throw new Error(`재료가 안 사라짐 (${cnt} → ${after})`);
  });

  await step('리그 순위표', async () => {
    await page.evaluate(() => goto('standings'));
    const txt = await page.textContent('#app');
    if (!txt.includes('리그 순위표')) throw new Error('제목 없음');
    const rows = await page.locator('table.box tbody tr').count();
    if (rows !== 10) throw new Error('팀이 10개가 아님: ' + rows);
  });

  await step('팀 기록실', async () => {
    await page.evaluate(() => goto('stats'));
    const txt = await page.textContent('#app');
    if (!txt.includes('타자') || !txt.includes('투수')) throw new Error('표가 없음');
  });

  await step('대결 랭킹 화면', async () => {
    await page.evaluate(() => goto('pvprank'));
    const txt = await page.textContent('#app');
    if (!txt.includes('전체 랭킹')) throw new Error('랭킹 영역 없음');
  });

  await step('상점에서 카드팩 구매', async () => {
    await page.evaluate(() => { state.coins = 5000; goto('shop'); });
    await page.locator('.pickCard .btn.small').first().click();
    await page.waitForTimeout(300);
    const packs = await peek(() => state.packs.length);
    if (packs < 1) throw new Error('팩이 안 늘어남');
  });

  await step('팩 개봉', async () => {
    await page.evaluate(() => goto('packs'));
    await page.locator('.pickCard .btn.small').first().click();
    await page.waitForTimeout(400);
    const m = await peek(() => state.modal && state.modal.type);
    if (m !== 'reveal') throw new Error('카드 공개창이 안 뜸');
    await page.evaluate(() => closeModal());
  });

  await step('데일리 선수 뽑기', async () => {
    await page.evaluate(() => goto('home'));
    await clickText('데일리 선수 선택하기', { wait: 400 });
    if (await peek(() => state.modal && state.modal.type) !== 'daily') throw new Error('데일리 창이 안 뜸');
    await page.locator('.modalBox .btn.small').first().click();
    await page.waitForTimeout(400);
    await page.evaluate(() => closeModal());
  });

  await step('이달의 선수', async () => {
    await page.evaluate(() => goto('monthly'));
    const txt = await page.textContent('#app');
    if (!txt || txt.length < 50) throw new Error('화면이 비어있음');
  });

  await step('골든글러브', async () => {
    await page.evaluate(() => goto('goldenglove'));
    const txt = await page.textContent('#app');
    if (!txt || txt.length < 50) throw new Error('화면이 비어있음');
  });

  await step('과제(미션) 화면', async () => {
    await page.evaluate(() => goto('missions'));
    const txt = await page.textContent('#app');
    if (!txt.includes('친선경기')) throw new Error('미션 목록 없음');
  });

  await step('리그모드 화면', async () => {
    await page.evaluate(() => goto('league'));
    const games = await page.locator('.scheduleItem').count();
    if (games !== 9) throw new Error('일정이 9경기가 아님: ' + games);
  });

  await step('리그 경기 1개 자동 진행 (끝까지)', async () => {
    await page.evaluate(() => { const s = state.schedule.find(x => !x.played); startLiveGame(s.teamId, true, true); });
    for (let i = 0; i < 150; i++) {
      if (await screen() === 'matchresult') break;
      await page.waitForTimeout(1000);
    }
    if (await screen() !== 'matchresult') throw new Error('150초 넘게 안 끝남 (현재: ' + await screen() + ')');
    const r = await peek(() => ({ inn: state.lastResult.userInnings.length, lv: (state.lastResult.leveled || []).length }));
    if (r.inn < 9) throw new Error('9이닝 미만: ' + r.inn);
  });

  await step('경기 결과 화면 내용', async () => {
    const txt = await page.textContent('#app');
    if (!txt.includes('경기 결과')) throw new Error('제목 없음');
    if (!/승리|패배/.test(txt)) throw new Error('승패 표시 없음');
  });

  await step('경기 후 순위표가 갱신되는가', async () => {
    await page.evaluate(() => goto('standings'));
    const played = await peek(() => standingsSorted().reduce((s, r) => s + r.g, 0));
    if (played < 2) throw new Error('순위표에 경기가 안 쌓임: ' + played);
  });

  await step('직접 플레이 경기 시작 (카운트 확인)', async () => {
    await page.evaluate(() => { const s = state.schedule.find(x => !x.played); startLiveGame(s.teamId, true, false); });
    await page.waitForTimeout(800);
    if (await screen() !== 'livegame') throw new Error('경기 화면이 안 열림');
    const txt = await page.textContent('#app');
    if (!/B\s*S\s*O|아웃/.test(txt.replace(/\s+/g, ' '))) { /* 카운트 박스는 점으로 표시되므로 존재만 확인 */ }
    const hasCount = await peek(() => !!(state.live && state.live.count));
    if (!hasCount) throw new Error('카운트가 없음');
  });

  await step('공 던지기 (카운트가 쌓이는가)', async () => {
    const before = await peek(() => ({ ...state.live.count, idx: state.live.oppIdx }));
    await page.evaluate(() => liveThrowPitch('fastball', 0.2, 0, 0));
    await page.waitForTimeout(1500);
    const after = await peek(() => state.live ? ({ ...state.live.count, idx: state.live.oppIdx }) : null);
    if (!after) throw new Error('경기가 사라짐');
    const changed = after.b !== before.b || after.s !== before.s || after.idx !== before.idx;
    if (!changed) throw new Error('아무 변화가 없음');
  });

  await step('투수 교체 창', async () => {
    await page.evaluate(() => openPitcherChange());
    await page.waitForTimeout(300);
    if (await peek(() => state.modal && state.modal.type) !== 'relief') throw new Error('교체창이 안 뜸');
    const before = await peek(() => state.live.userStaff.cur.id);
    await page.locator('.modalBox .btn.small').first().click();
    await page.waitForTimeout(300);
    const after = await peek(() => state.live.userStaff.cur.id);
    if (before === after) throw new Error('투수가 안 바뀜');
  });

  await step('결과 바로보기로 경기 끝내기', async () => {
    await page.evaluate(() => skipLiveGame());
    await page.waitForTimeout(1200);
    if (await screen() !== 'matchresult') throw new Error('경기가 안 끝남: ' + await screen());
  });

  await step('남은 리그 경기 전부 소화', async () => {
    await page.evaluate(() => {
      state.schedule.forEach(s => { if (!s.played) playMatch(s.teamId, true); });
    });
    await page.waitForTimeout(500);
    const done = await peek(() => state.schedule.every(s => s.played));
    if (!done) throw new Error('경기가 남음');
  });

  await step('시즌 결산', async () => {
    await page.evaluate(() => goto('league'));
    await clickText('시즌 결산하기', { wait: 600 });
    await page.evaluate(() => closeModal());
    const season = await peek(() => state.season);
    if (season !== 2) throw new Error('시즌이 안 넘어감: ' + season);
  });

  await step('시즌 후 기록/순위표 초기화', async () => {
    const ok = await peek(() => standingsSorted().every(r => r.g === 0) && state.roster.batters.every(p => p.stat.ab === 0));
    if (!ok) throw new Error('초기화가 안 됨');
    const grew = await peek(() => state.roster.batters.some(p => p.lv > 1));
    if (!grew) throw new Error('레벨이 초기화돼버림');
  });

  await step('새로고침해도 기록이 남는가 (저장)', async () => {
    const before = await peek(() => ({ team: state.team.name, coins: state.coins, season: state.season, nick: state.user.nickname }));
    await page.reload();
    await page.waitForTimeout(1500);
    const after = await peek(() => ({ team: state.team.name, coins: state.coins, season: state.season, nick: state.user && state.user.nickname }));
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error(`저장 내용이 다름\n     전: ${JSON.stringify(before)}\n     후: ${JSON.stringify(after)}`);
    }
    if (await screen() !== 'home') throw new Error('홈 화면으로 안 돌아옴: ' + await screen());
  });

  await step('친선경기', async () => {
    await page.evaluate(() => goto('friendly'));
    const rows = await page.locator('.scheduleItem').count();
    if (rows !== 9) throw new Error('상대가 9팀이 아님: ' + rows);
  });

  await step('처음부터 다시 시작 (확인창)', async () => {
    await page.evaluate(() => goto('home'));
    await clickText('처음부터', { wait: 400 });
    if (await peek(() => state.modal && state.modal.type) !== 'resetConfirm') throw new Error('확인창이 안 뜸');
    await page.evaluate(() => closeModal());
    if (await peek(() => !!state.team) !== true) throw new Error('취소했는데 팀이 사라짐');
  });

  console.log('\n===== 결과 =====');
  if (errors.length) {
    console.log(`\n❌ 오류 ${errors.length}건:\n`);
    [...new Set(errors)].forEach(e => console.log('  • ' + e));
  } else {
    console.log('\n✅ 오류 없음');
  }
  await page.screenshot({ path: '/tmp/claude-0/game-home.png' });
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
