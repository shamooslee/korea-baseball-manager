/**
 * 코리아 야구 매니저 - 실시간 PvP 서버
 * ------------------------------------------------
 * 설치:   npm install ws
 * 실행:   node server.js
 * 환경변수 PORT로 포트 지정 가능 (기본 8080)
 *
 * 배포 예시: Render / Railway / Fly.io / 자체 VPS 등 Node.js를 띄울 수 있는
 * 곳이면 어디든 가능합니다. 배포 후 클라이언트(HTML)에서
 * "wss://your-app-domain" 형태의 주소로 접속하면 됩니다.
 * (로컬 테스트 시에는 "ws://localhost:8080")
 *
 * 이 서버는 데모/개인 프로젝트 수준입니다. 프로덕션으로 쓰려면
 * 인증, 재접속 처리, 부정행위 검증(클라이언트가 보낸 능력치를
 * 그대로 신뢰하지 않는 등), 로드밸런싱/영속 저장소 등이 추가로 필요합니다.
 */
const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`[야구매니저 PvP] WebSocket 서버 시작됨 - 포트 ${PORT}`);

/* ================= 야구 시뮬레이션 로직 (클라이언트와 동일한 규칙) ================= */
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

const GROUND_FIELDERS = ['1루수','2루수','3루수','유격수'];
const FLY_FIELDERS = ['좌익수','중견수','우익수'];
function describeOut(){
  return Math.random()<0.5 ? (pick(GROUND_FIELDERS)+' 땅볼 아웃') : (pick(FLY_FIELDERS)+' 플라이 아웃');
}
function pitchLocationMod(pitchType, zoneDist){
  const inZone = zoneDist <= 0.5;
  let controlAdj, stuffAdj;
  if(inZone){
    const edge = clamp(zoneDist/0.5, 0, 1);
    controlAdj = 4 + edge*8;
    stuffAdj = pitchType==='breaking' ? (4+edge*4) : (-2+edge*2);
  } else {
    const out = clamp((zoneDist-0.5)/0.8, 0, 1);
    controlAdj = -6 - out*10;
    stuffAdj = pitchType==='breaking' ? (8+out*8) : (2+out*4);
  }
  return { controlAdj, stuffAdj };
}

function simAtBat(batter, pitcher){
  const off = batter.contact*0.5 + batter.power*0.3 + batter.speed*0.2;
  const def = pitcher.control*0.55 + pitcher.stuff*0.35 + pitcher.stamina*0.10;
  const edge = (off-def)/100;
  const pOut = clamp(0.62-edge*0.35, 0.35, 0.80);
  const pBB = clamp(0.07-edge*0.02, 0.03, 0.15);
  const r = Math.random();
  if(r < pOut) return Math.random()<0.55 ? 'K':'OUT';
  if(r < pOut+pBB) return 'BB';
  const powerFactor = batter.power/100;
  let wS=0.60-0.15*powerFactor, wD=0.22+0.05*powerFactor, wT=0.04+0.03*(batter.speed/100), wH=0.14+0.30*powerFactor;
  const sum=wS+wD+wT+wH; wS/=sum; wD/=sum; wT/=sum; wH/=sum;
  const rr = Math.random();
  if(rr<wS) return '1B';
  if(rr<wS+wD) return '2B';
  if(rr<wS+wD+wT) return '3B';
  return 'HR';
}
function applyPitchMod(pitcher, mod){
  const p = Object.assign({}, pitcher);
  p.control = clamp(p.control + mod.controlAdj, 1, 99);
  p.stuff = clamp(p.stuff + mod.stuffAdj, 1, 99);
  return p;
}
function computeSwingResult(batter, pitcherMod, swingType, timingQuality){
  if(timingQuality===null || timingQuality===undefined){
    const pBBtake = clamp(0.35 + (100-pitcherMod.control)/300, 0.15, 0.6);
    return Math.random()<pBBtake ? 'BB' : 'OUT';
  }
  const q = clamp(+timingQuality, -0.4, 1);
  const b = Object.assign({}, batter);
  if(swingType==='power'){ b.power+=12; b.contact-=10; } else { b.contact+=8; b.power-=8; }
  b.contact = clamp(b.contact + q*15, 1, 99);
  b.power = clamp(b.power + q*15, 1, 99);
  return simAtBat(b, pitcherMod);
}
function resolveAtBat(res, batter, bases, label, outsBeforePlay){
  let runs=0, hit=false;
  const b = bases.slice();
  let log = '';
  if(res==='K' || res==='OUT'){
    if(res==='K'){
      log = `${label} ${batter.name} 삼진 아웃`;
    } else {
      const desc = describeOut();
      if(desc.includes('플라이') && b[2] && outsBeforePlay<2){
        runs++; b[2]=false;
        log = `${label} ${batter.name} ${desc} (희생플라이 득점)`;
      } else {
        log = `${label} ${batter.name} ${desc}`;
      }
    }
  } else if(res==='BB'){
    if(b[0]&&b[1]&&b[2]){ runs++; }
    else if(b[0]&&b[1]){ b[2]=true; }
    else if(b[0]){ b[1]=true; }
    b[0]=true;
    log = `${label} ${batter.name} 볼넷 출루`;
  } else if(res==='1B'){
    hit=true; let sc=0;
    if(b[2]){sc++;b[2]=false;}
    if(b[1]){ if(Math.random()<0.35+batter.speed/300){sc++;} else b[2]=true; b[1]=false; }
    if(b[0]){ b[1]=true; b[0]=false; }
    b[0]=true; runs+=sc;
    log = `${label} ${batter.name} 안타!${sc?` (${sc}점 득점)`:''}`;
  } else if(res==='2B'){
    hit=true; let sc=0;
    if(b[2]){sc++;b[2]=false;}
    if(b[1]){sc++;b[1]=false;}
    if(b[0]){ if(Math.random()<0.3+batter.speed/300){sc++;} else b[2]=true; b[0]=false; }
    b[1]=true; runs+=sc;
    log = `${label} ${batter.name} 2루타!${sc?` (${sc}점 득점)`:''}`;
  } else if(res==='3B'){
    hit=true; const sc=(b[0]?1:0)+(b[1]?1:0)+(b[2]?1:0);
    b[0]=false; b[1]=false; b[2]=true; runs+=sc;
    log = `${label} ${batter.name} 3루타!${sc?` (${sc}점 득점)`:''}`;
  } else if(res==='HR'){
    hit=true; const sc=1+(b[0]?1:0)+(b[1]?1:0)+(b[2]?1:0);
    b[0]=false; b[1]=false; b[2]=false; runs+=sc;
    log = `${label} ${batter.name} 홈런! (${sc}점 득점)`;
  }
  return { runs, hit, bases:b, log, isOut: (res==='K'||res==='OUT') };
}

/* ================= 매치메이킹 & 세션 관리 ================= */
let waiting = null; // 대기 중인 한 명의 접속 정보 {ws, info}
const matches = new Map(); // matchId -> match state
let matchCounter = 1;

function send(ws, obj){
  if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function makeMatch(pA, pB){
  const matchId = 'm' + (matchCounter++);
  // 무작위로 홈/원정 배정 (home = 후공/말공격, away = 선공/초공격)
  const homeFirst = Math.random()<0.5;
  const home = homeFirst ? pA : pB;
  const away = homeFirst ? pB : pA;
  const match = {
    id: matchId,
    home, away,
    half:'top', inning:1, outs:0, bases:[false,false,false], curRuns:0,
    runsHome:0, runsAway:0, hitsHome:0, hitsAway:0,
    inningsHome:[], inningsAway:[],
    idxHome:0, idxAway:0,
    pendingPitchInfo:null
  };
  matches.set(matchId, match);
  home.ws.matchId = matchId; away.ws.matchId = matchId;
  home.ws.role = 'home'; away.ws.role = 'away';

  send(home.ws, { type:'matched', role:'home', opponentName:away.info.name, opponentTeamName:away.info.teamName });
  send(away.ws, { type:'matched', role:'away', opponentName:home.info.name, opponentTeamName:home.info.teamName });
  broadcastTurnPrompt(match);
}

function currentBatterInfo(match){
  const battingSide = match.half==='top' ? 'away' : 'home';
  const p = match[battingSide];
  const idxKey = battingSide==='home' ? 'idxHome' : 'idxAway';
  const lineup = p.info.lineup;
  return { battingSide, batter: lineup[match[idxKey] % lineup.length] };
}

function broadcastTurnPrompt(match){
  match.pendingPitchInfo = null;
  const { battingSide, batter } = currentBatterInfo(match);
  const payload = {
    type:'atbat_pending',
    half: match.half, inning: match.inning, outs: match.outs, bases: match.bases,
    runsHome: match.runsHome, runsAway: match.runsAway,
    batterName: batter.name
  };
  send(match.home.ws, Object.assign({}, payload, { yourRole: battingSide==='home' ? 'swing' : 'pitch' }));
  send(match.away.ws, Object.assign({}, payload, { yourRole: battingSide==='away' ? 'swing' : 'pitch' }));
}

function resolveFinishedAtBat(match, res, battingSide, batter){
  const label = battingSide==='home' ? match.home.info.teamName : match.away.info.teamName;
  const r = resolveAtBat(res, batter, match.bases, label, match.outs);

  match.bases = r.bases;
  match.curRuns += r.runs;
  if(battingSide==='home') match.runsHome += r.runs; else match.runsAway += r.runs;
  if(r.hit){ if(battingSide==='home') match.hitsHome++; else match.hitsAway++; }
  if(r.isOut) match.outs++;
  if(battingSide==='home') match.idxHome++; else match.idxAway++;

  const payload = {
    type:'atbat_result', log:r.log, res,
    half: match.half, inning: match.inning, outs: match.outs, bases: match.bases,
    runsHome: match.runsHome, runsAway: match.runsAway,
    hitsHome: match.hitsHome, hitsAway: match.hitsAway
  };
  send(match.home.ws, payload);
  send(match.away.ws, payload);

  if(match.outs>=3){
    if(match.half==='top'){
      match.inningsAway.push(match.curRuns);
      match.curRuns=0; match.outs=0; match.bases=[false,false,false];
      match.half='bottom';
    } else {
      match.inningsHome.push(match.curRuns);
      match.curRuns=0; match.outs=0; match.bases=[false,false,false];
      match.inning++; match.half='top';
      if((match.inning>9 && match.runsHome!==match.runsAway) || match.inning>12){
        finishMatch(match);
        return;
      }
    }
  }
  setTimeout(()=>{ if(matches.has(match.id)) broadcastTurnPrompt(match); }, 900);
}

function finishMatch(match){
  const winner = match.runsHome > match.runsAway ? 'home' :
                 match.runsAway > match.runsHome ? 'away' :
                 (Math.random()<0.5 ? 'home':'away');
  const payload = {
    type:'game_over', winner,
    runsHome: match.runsHome, runsAway: match.runsAway,
    hitsHome: match.hitsHome, hitsAway: match.hitsAway,
    inningsHome: match.inningsHome, inningsAway: match.inningsAway
  };
  send(match.home.ws, payload);
  send(match.away.ws, payload);
  matches.delete(match.id);
}

function handleLeave(ws){
  if(waiting && waiting.ws === ws) waiting = null;
  const matchId = ws.matchId;
  if(matchId && matches.has(matchId)){
    const match = matches.get(matchId);
    const other = match.home.ws === ws ? match.away.ws : match.home.ws;
    send(other, { type:'opponent_left' });
    matches.delete(matchId);
  }
}

wss.on('connection', (ws)=>{
  ws.on('message', (raw)=>{
    let msg;
    try { msg = JSON.parse(raw); } catch(e){ return; }

    if(msg.type === 'join'){
      const info = {
        name: String(msg.name||'플레이어').slice(0,10),
        teamName: String(msg.teamName||'무명팀').slice(0,20),
        lineup: Array.isArray(msg.lineup) ? msg.lineup.slice(0,9).map(b=>({
          name:String(b.name||'선수').slice(0,12),
          contact:clamp(+b.contact||60,1,99),
          power:clamp(+b.power||60,1,99),
          speed:clamp(+b.speed||60,1,99)
        })) : [],
        pitcher: msg.pitcher ? {
          name:String(msg.pitcher.name||'투수').slice(0,12),
          control:clamp(+msg.pitcher.control||60,1,99),
          stuff:clamp(+msg.pitcher.stuff||60,1,99),
          stamina:clamp(+msg.pitcher.stamina||60,1,99)
        } : {name:'투수',control:60,stuff:60,stamina:60}
      };
      if(info.lineup.length < 9){
        send(ws, { type:'error', message:'라인업 정보가 올바르지 않습니다.' });
        return;
      }
      if(waiting){
        const opp = waiting; waiting = null;
        makeMatch(opp, { ws, info });
      } else {
        waiting = { ws, info };
        send(ws, { type:'queued' });
      }
      return;
    }

    if(msg.type === 'pitch'){
      const matchId = ws.matchId;
      if(!matchId || !matches.has(matchId)) return;
      const match = matches.get(matchId);
      const { battingSide } = currentBatterInfo(match);
      const pitchingSide = battingSide==='home' ? 'away' : 'home';
      const mySide = match.home.ws === ws ? 'home' : 'away';
      if(mySide !== pitchingSide || match.pendingPitchInfo) return;
      const pitchType = msg.pitchType==='breaking' ? 'breaking' : 'fastball';
      const zoneDist = clamp(+msg.zoneDist || 0, 0, 1.6);
      const dx = clamp(+msg.dx || 0, -2, 2);
      const dy = clamp(+msg.dy || 0, -2, 2);
      match.pendingPitchInfo = { pitchType, zoneDist, dx, dy };
      const payload = { type:'pitch_thrown', pitchType, zoneDist, dx, dy };
      send(match.home.ws, payload);
      send(match.away.ws, payload);
      return;
    }

    if(msg.type === 'swing_result'){
      const matchId = ws.matchId;
      if(!matchId || !matches.has(matchId)) return;
      const match = matches.get(matchId);
      if(!match.pendingPitchInfo) return;
      const { battingSide, batter } = currentBatterInfo(match);
      const mySide = match.home.ws === ws ? 'home' : 'away';
      if(mySide !== battingSide) return;
      const pitchingSide = battingSide==='home' ? 'away' : 'home';
      const rawPitcher = match[pitchingSide].info.pitcher;
      const pitcherMod = applyPitchMod(rawPitcher, pitchLocationMod(match.pendingPitchInfo.pitchType, match.pendingPitchInfo.zoneDist));
      const swingType = msg.swingType==='power' ? 'power' : 'contact';
      const timingQuality = (msg.timingQuality===null || msg.timingQuality===undefined) ? null : clamp(+msg.timingQuality, -0.4, 1);
      const res = computeSwingResult(batter, pitcherMod, swingType, timingQuality);
      match.pendingPitchInfo = null;
      resolveFinishedAtBat(match, res, battingSide, batter);
      return;
    }

    if(msg.type === 'leave'){
      handleLeave(ws);
    }
  });

  ws.on('close', ()=>{ handleLeave(ws); });
});
