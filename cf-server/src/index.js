/**
 * 야구선수훈련게임 - 실시간 대결 서버 (Cloudflare Workers + Durable Objects)
 *
 * 왜 Durable Object를 쓰나:
 *   보통의 Workers는 요청마다 따로 실행돼서 "지금 누가 기다리고 있는지"를 기억하지 못한다.
 *   Durable Object는 하나의 방(room)처럼 계속 살아 있어서, 매칭과 경기 진행,
 *   랭킹 저장을 한곳에서 할 수 있다.
 *
 * 배포:  npx wrangler deploy
 * 로컬:  npx wrangler dev
 */
import {
  clamp, applyPitchMod, pitchLocationMod,
  computeSwingResult, resolveAtBat, sanitizeInfo
} from './game.js';

const LOBBY_NAME = 'global';          // 방 하나로 전부 처리한다 (플레이어가 많지 않으므로)
const AB_DELAY_DEFAULT = 900;         // 타석 사이 간격(밀리초)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* 서버가 살아있는지 확인하는 주소 */
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, service: '야구선수훈련게임 대결서버' }), {
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }

    /* 랭킹만 보고 싶을 때 (웹브라우저로 바로 열어볼 수 있다) */
    if (url.pathname === '/ranking') {
      const id = env.GAME_LOBBY.idFromName(LOBBY_NAME);
      return env.GAME_LOBBY.get(id).fetch(new Request('https://do/ranking'));
    }

    /* 게임 접속 (WebSocket) */
    if (request.headers.get('Upgrade') === 'websocket') {
      const id = env.GAME_LOBBY.idFromName(LOBBY_NAME);
      return env.GAME_LOBBY.get(id).fetch(request);
    }

    return new Response(
      '야구선수훈련게임 실시간 대결 서버입니다.\n게임에서 이 주소로 접속하세요.\n랭킹 보기: /ranking',
      { headers: { 'content-type': 'text/plain; charset=utf-8' } }
    );
  }
};

export class GameLobby {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.abDelay = Number((env && env.AB_DELAY) || AB_DELAY_DEFAULT);
  }

  /* ---------- 접속 처리 ---------- */
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ranking') {
      return new Response(JSON.stringify({ list: await this.rankingList(20) }, null, 2), {
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket 연결이 필요합니다.', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    /* 잠자기(hibernation) 방식으로 받는다.
       아무도 안 움직이는 동안에는 서버가 쉬어서 무료 한도를 아낀다. */
    this.state.acceptWebSocket(server);
    const connId = crypto.randomUUID();
    server.serializeAttachment({ connId, joined: false });
    return new Response(null, { status: 101, webSocket: client });
  }

  /* ---------- 도우미 ---------- */
  att(ws) { return ws.deserializeAttachment() || {}; }
  setAtt(ws, patch) { ws.serializeAttachment(Object.assign({}, this.att(ws), patch)); }
  send(ws, obj) {
    try { if (ws && ws.readyState === WebSocket.READY_STATE_OPEN) ws.send(JSON.stringify(obj)); }
    catch (e) { /* 이미 끊긴 연결은 무시 */ }
  }
  findWs(connId) {
    if (!connId) return null;
    for (const ws of this.state.getWebSockets()) {
      if (this.att(ws).connId === connId) return ws;
    }
    return null;
  }

  /* ---------- 랭킹 ---------- */
  async getRanks() { return (await this.state.storage.get('ranks')) || {}; }
  async recordResult(name, teamName, myRuns, oppRuns, win) {
    const ranks = await this.getRanks();
    if (!ranks[name]) ranks[name] = { name, teamName: teamName || '', w: 0, l: 0, rf: 0, ra: 0, streak: 0, best: 0 };
    const e = ranks[name];
    if (teamName) e.teamName = teamName;
    e.rf += myRuns; e.ra += oppRuns;
    if (win) { e.w++; e.streak = e.streak > 0 ? e.streak + 1 : 1; }
    else { e.l++; e.streak = e.streak < 0 ? e.streak - 1 : -1; }
    if (e.streak > e.best) e.best = e.streak;
    e.lastSeen = Date.now();
    await this.state.storage.put('ranks', ranks);
  }
  async rankingList(limit) {
    const ranks = await this.getRanks();
    return Object.values(ranks)
      .filter(e => e.w + e.l > 0)
      .sort((a, b) => {
        const pa = a.w / (a.w + a.l), pb = b.w / (b.w + b.l);
        return pb - pa || b.w - a.w || (b.rf - b.ra) - (a.rf - a.ra);
      })
      .slice(0, limit || 20)
      .map(e => ({ name: e.name, teamName: e.teamName, w: e.w, l: e.l, rf: e.rf, ra: e.ra, best: e.best }));
  }

  /* ---------- 경기 상태 저장 ---------- */
  matchKey(id) { return 'match:' + id; }
  async getMatch(id) { return id ? await this.state.storage.get(this.matchKey(id)) : null; }
  async putMatch(m) { await this.state.storage.put(this.matchKey(m.id), m); }
  async delMatch(id) { await this.state.storage.delete(this.matchKey(id)); }

  /* ---------- 메시지 처리 ---------- */
  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'ranking') {
      this.send(ws, { type: 'ranking', list: await this.rankingList(20) });
      return;
    }
    if (msg.type === 'join') return this.handleJoin(ws, msg);
    if (msg.type === 'pitch') return this.handlePitch(ws, msg);
    if (msg.type === 'swing_result') return this.handleSwing(ws, msg);
    if (msg.type === 'leave') return this.handleLeave(ws);
  }

  async handleJoin(ws, msg) {
    const info = sanitizeInfo(msg);
    if (info.lineup.length < 9) {
      this.send(ws, { type: 'error', message: '라인업 정보가 올바르지 않습니다.' });
      return;
    }
    const me = this.att(ws);
    this.setAtt(ws, { joined: true, info });

    const waitingId = await this.state.storage.get('waiting');
    const waitingWs = this.findWs(waitingId);

    if (waitingWs && waitingId !== me.connId) {
      await this.state.storage.delete('waiting');
      await this.makeMatch(waitingWs, ws);
    } else {
      await this.state.storage.put('waiting', me.connId);
      this.send(ws, { type: 'queued' });
    }
  }

  async makeMatch(wsA, wsB) {
    const counter = ((await this.state.storage.get('matchCounter')) || 0) + 1;
    await this.state.storage.put('matchCounter', counter);
    const matchId = 'm' + counter;

    /* 홈/원정을 무작위로 정한다 (홈이 후공) */
    const homeFirst = Math.random() < 0.5;
    const homeWs = homeFirst ? wsA : wsB;
    const awayWs = homeFirst ? wsB : wsA;
    const homeAtt = this.att(homeWs), awayAtt = this.att(awayWs);

    const match = {
      id: matchId,
      homeId: homeAtt.connId, awayId: awayAtt.connId,
      homeInfo: homeAtt.info, awayInfo: awayAtt.info,
      half: 'top', inning: 1, outs: 0, bases: [false, false, false], curRuns: 0,
      runsHome: 0, runsAway: 0, hitsHome: 0, hitsAway: 0,
      inningsHome: [], inningsAway: [],
      idxHome: 0, idxAway: 0,
      pendingPitchInfo: null
    };
    await this.putMatch(match);
    this.setAtt(homeWs, { matchId, role: 'home' });
    this.setAtt(awayWs, { matchId, role: 'away' });

    this.send(homeWs, { type: 'matched', role: 'home', opponentName: awayAtt.info.name, opponentTeamName: awayAtt.info.teamName });
    this.send(awayWs, { type: 'matched', role: 'away', opponentName: homeAtt.info.name, opponentTeamName: homeAtt.info.teamName });
    await this.broadcastTurnPrompt(match);
  }

  currentBatter(match) {
    const battingSide = match.half === 'top' ? 'away' : 'home';
    const info = battingSide === 'home' ? match.homeInfo : match.awayInfo;
    const idx = battingSide === 'home' ? match.idxHome : match.idxAway;
    return { battingSide, batter: info.lineup[idx % info.lineup.length] };
  }

  async broadcastTurnPrompt(match) {
    match.pendingPitchInfo = null;
    await this.putMatch(match);
    const { battingSide, batter } = this.currentBatter(match);
    const base = {
      type: 'atbat_pending',
      half: match.half, inning: match.inning, outs: match.outs, bases: match.bases,
      runsHome: match.runsHome, runsAway: match.runsAway,
      batterName: batter.name
    };
    const homeWs = this.findWs(match.homeId), awayWs = this.findWs(match.awayId);
    this.send(homeWs, Object.assign({}, base, { yourRole: battingSide === 'home' ? 'swing' : 'pitch' }));
    this.send(awayWs, Object.assign({}, base, { yourRole: battingSide === 'away' ? 'swing' : 'pitch' }));
  }

  async handlePitch(ws, msg) {
    const a = this.att(ws);
    const match = await this.getMatch(a.matchId);
    if (!match || match.pendingPitchInfo) return;
    const { battingSide } = this.currentBatter(match);
    const pitchingSide = battingSide === 'home' ? 'away' : 'home';
    if (a.role !== pitchingSide) return;

    const info = {
      pitchType: msg.pitchType === 'breaking' ? 'breaking' : 'fastball',
      zoneDist: clamp(+msg.zoneDist || 0, 0, 1.6),
      dx: clamp(+msg.dx || 0, -2, 2),
      dy: clamp(+msg.dy || 0, -2, 2)
    };
    match.pendingPitchInfo = info;
    await this.putMatch(match);

    const payload = Object.assign({ type: 'pitch_thrown' }, info);
    this.send(this.findWs(match.homeId), payload);
    this.send(this.findWs(match.awayId), payload);
  }

  async handleSwing(ws, msg) {
    const a = this.att(ws);
    const match = await this.getMatch(a.matchId);
    if (!match || !match.pendingPitchInfo) return;
    const { battingSide, batter } = this.currentBatter(match);
    if (a.role !== battingSide) return;

    const pitchingSide = battingSide === 'home' ? 'away' : 'home';
    const rawPitcher = (pitchingSide === 'home' ? match.homeInfo : match.awayInfo).pitcher;
    const pitcherMod = applyPitchMod(
      rawPitcher,
      pitchLocationMod(match.pendingPitchInfo.pitchType, match.pendingPitchInfo.zoneDist)
    );
    const swingType = msg.swingType === 'power' ? 'power' : 'contact';
    const timingQuality = (msg.timingQuality === null || msg.timingQuality === undefined)
      ? null : clamp(+msg.timingQuality, -0.4, 1);
    const res = computeSwingResult(batter, pitcherMod, swingType, timingQuality);

    match.pendingPitchInfo = null;
    await this.resolveFinishedAtBat(match, res, battingSide, batter);
  }

  async resolveFinishedAtBat(match, res, battingSide, batter) {
    const label = battingSide === 'home' ? match.homeInfo.teamName : match.awayInfo.teamName;
    const r = resolveAtBat(res, batter, match.bases, label, match.outs);

    match.bases = r.bases;
    match.curRuns += r.runs;
    if (battingSide === 'home') match.runsHome += r.runs; else match.runsAway += r.runs;
    if (r.hit) { if (battingSide === 'home') match.hitsHome++; else match.hitsAway++; }
    if (r.isOut) match.outs++;
    if (battingSide === 'home') match.idxHome++; else match.idxAway++;

    const payload = {
      type: 'atbat_result', log: r.log, res,
      half: match.half, inning: match.inning, outs: match.outs, bases: match.bases,
      runsHome: match.runsHome, runsAway: match.runsAway,
      hitsHome: match.hitsHome, hitsAway: match.hitsAway
    };
    this.send(this.findWs(match.homeId), payload);
    this.send(this.findWs(match.awayId), payload);

    /* 3아웃이면 공수 교대 */
    if (match.outs >= 3) {
      if (match.half === 'top') {
        match.inningsAway.push(match.curRuns);
        match.curRuns = 0; match.outs = 0; match.bases = [false, false, false];
        match.half = 'bottom';
      } else {
        match.inningsHome.push(match.curRuns);
        match.curRuns = 0; match.outs = 0; match.bases = [false, false, false];
        match.inning++; match.half = 'top';
        if ((match.inning > 9 && match.runsHome !== match.runsAway) || match.inning > 12) {
          await this.finishMatch(match);
          return;
        }
      }
    }
    await this.putMatch(match);
    /* 결과를 읽을 시간을 준 뒤 다음 타자 */
    if (this.abDelay > 0) await this.sleep(this.abDelay);
    const fresh = await this.getMatch(match.id);
    if (fresh) await this.broadcastTurnPrompt(fresh);
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async finishMatch(match) {
    const winner = match.runsHome > match.runsAway ? 'home'
      : match.runsAway > match.runsHome ? 'away'
      : (Math.random() < 0.5 ? 'home' : 'away');
    const payload = {
      type: 'game_over', winner,
      runsHome: match.runsHome, runsAway: match.runsAway,
      hitsHome: match.hitsHome, hitsAway: match.hitsAway,
      inningsHome: match.inningsHome, inningsAway: match.inningsAway
    };
    const homeWs = this.findWs(match.homeId), awayWs = this.findWs(match.awayId);
    this.send(homeWs, payload);
    this.send(awayWs, payload);

    await this.recordResult(match.homeInfo.name, match.homeInfo.teamName, match.runsHome, match.runsAway, winner === 'home');
    await this.recordResult(match.awayInfo.name, match.awayInfo.teamName, match.runsAway, match.runsHome, winner === 'away');

    const rankMsg = { type: 'ranking', list: await this.rankingList(20) };
    this.send(homeWs, rankMsg);
    this.send(awayWs, rankMsg);

    if (homeWs) this.setAtt(homeWs, { matchId: null, role: null });
    if (awayWs) this.setAtt(awayWs, { matchId: null, role: null });
    await this.delMatch(match.id);
  }

  async handleLeave(ws) {
    const a = this.att(ws);
    const waitingId = await this.state.storage.get('waiting');
    if (waitingId && waitingId === a.connId) await this.state.storage.delete('waiting');

    const match = await this.getMatch(a.matchId);
    if (match) {
      const otherId = match.homeId === a.connId ? match.awayId : match.homeId;
      const otherWs = this.findWs(otherId);
      this.send(otherWs, { type: 'opponent_left' });
      if (otherWs) this.setAtt(otherWs, { matchId: null, role: null });
      await this.delMatch(match.id);
    }
    this.setAtt(ws, { matchId: null, role: null });
  }

  async webSocketClose(ws) { await this.handleLeave(ws); }
  async webSocketError(ws) { await this.handleLeave(ws); }
}
