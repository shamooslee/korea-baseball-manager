/**
 * 야구 규칙 계산 부분.
 * 이 파일은 게임 화면(index.html)과 똑같은 규칙을 쓴다.
 * 접속·매칭과 상관없는 순수 계산만 들어 있어서 그대로 옮겨왔다.
 */

export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const GROUND_FIELDERS = ['1루수', '2루수', '3루수', '유격수'];
const FLY_FIELDERS = ['좌익수', '중견수', '우익수'];

export function describeOut() {
  return Math.random() < 0.5
    ? (pick(GROUND_FIELDERS) + ' 땅볼 아웃')
    : (pick(FLY_FIELDERS) + ' 플라이 아웃');
}

export function pitchLocationMod(pitchType, zoneDist) {
  const inZone = zoneDist <= 0.5;
  let controlAdj, stuffAdj;
  if (inZone) {
    const edge = clamp(zoneDist / 0.5, 0, 1);
    controlAdj = 4 + edge * 8;
    stuffAdj = pitchType === 'breaking' ? (4 + edge * 4) : (-2 + edge * 2);
  } else {
    const out = clamp((zoneDist - 0.5) / 0.8, 0, 1);
    controlAdj = -6 - out * 10;
    stuffAdj = pitchType === 'breaking' ? (8 + out * 8) : (2 + out * 4);
  }
  return { controlAdj, stuffAdj };
}

export function applyPitchMod(pitcher, mod) {
  const p = Object.assign({}, pitcher);
  p.control = clamp(p.control + mod.controlAdj, 1, 99);
  p.stuff = clamp(p.stuff + mod.stuffAdj, 1, 99);
  return p;
}

export function simAtBat(batter, pitcher) {
  const off = batter.contact * 0.5 + batter.power * 0.3 + batter.speed * 0.2;
  const def = pitcher.control * 0.55 + pitcher.stuff * 0.35 + pitcher.stamina * 0.10;
  const edge = (off - def) / 100;
  const pOut = clamp(0.62 - edge * 0.35, 0.35, 0.80);
  const pBB = clamp(0.07 - edge * 0.02, 0.03, 0.15);
  const r = Math.random();
  if (r < pOut) return Math.random() < 0.55 ? 'K' : 'OUT';
  if (r < pOut + pBB) return 'BB';
  /* 안타 100개 중 홈런이 13개쯤 되도록 맞춘 비율 (실제 야구와 비슷하게) */
  const powerFactor = batter.power / 100;
  let wS = 0.60 - 0.15 * powerFactor,
      wD = 0.22 + 0.05 * powerFactor,
      wT = 0.04 + 0.03 * (batter.speed / 100),
      wH = 0.035 + 0.105 * powerFactor;
  const sum = wS + wD + wT + wH;
  wS /= sum; wD /= sum; wT /= sum; wH /= sum;
  const rr = Math.random();
  if (rr < wS) return '1B';
  if (rr < wS + wD) return '2B';
  if (rr < wS + wD + wT) return '3B';
  return 'HR';
}

export function applyBattingQuality(batter, swingType, timingQuality) {
  const b = Object.assign({}, batter);
  if (swingType === 'power') { b.power += 12; b.contact -= 10; }
  else { b.contact += 8; b.power -= 8; }
  b.contact = clamp(b.contact + timingQuality * 15, 1, 99);
  b.power = clamp(b.power + timingQuality * 15, 1, 99);
  return b;
}

export function computeSwingResult(batter, pitcherMod, swingType, timingQuality) {
  if (timingQuality === null || timingQuality === undefined) {
    /* 안 휘두르고 지켜본 경우 */
    const pBBtake = clamp(0.35 + (100 - pitcherMod.control) / 300, 0.15, 0.6);
    return Math.random() < pBBtake ? 'BB' : 'OUT';
  }
  const q = clamp(+timingQuality, -0.4, 1);
  const b = applyBattingQuality(batter, swingType === 'power' ? 'power' : 'contact', q);
  return simAtBat(b, pitcherMod);
}

/** 타격 결과를 주자·점수에 반영한다 */
export function resolveAtBat(res, batter, bases, label, outsBeforePlay) {
  let runs = 0, hit = false;
  const b = bases.slice();
  let log = '';
  if (res === 'K' || res === 'OUT') {
    if (res === 'K') {
      log = `${label} ${batter.name} 삼진 아웃`;
    } else {
      const desc = describeOut();
      if (desc.includes('플라이') && b[2] && outsBeforePlay < 2) {
        runs++; b[2] = false;
        log = `${label} ${batter.name} ${desc} (희생플라이 득점)`;
      } else {
        log = `${label} ${batter.name} ${desc}`;
      }
    }
  } else if (res === 'BB') {
    if (b[0] && b[1] && b[2]) { runs++; }
    else if (b[0] && b[1]) { b[2] = true; }
    else if (b[0]) { b[1] = true; }
    b[0] = true;
    log = `${label} ${batter.name} 볼넷 출루`;
  } else if (res === '1B') {
    hit = true; let sc = 0;
    if (b[2]) { sc++; b[2] = false; }
    if (b[1]) { if (Math.random() < 0.35 + batter.speed / 300) { sc++; } else b[2] = true; b[1] = false; }
    if (b[0]) { b[1] = true; b[0] = false; }
    b[0] = true; runs += sc;
    log = `${label} ${batter.name} 안타!${sc ? ` (${sc}점 득점)` : ''}`;
  } else if (res === '2B') {
    hit = true; let sc = 0;
    if (b[2]) { sc++; b[2] = false; }
    if (b[1]) { sc++; b[1] = false; }
    if (b[0]) { if (Math.random() < 0.3 + batter.speed / 300) { sc++; } else b[2] = true; b[0] = false; }
    b[1] = true; runs += sc;
    log = `${label} ${batter.name} 2루타!${sc ? ` (${sc}점 득점)` : ''}`;
  } else if (res === '3B') {
    hit = true;
    const sc = (b[0] ? 1 : 0) + (b[1] ? 1 : 0) + (b[2] ? 1 : 0);
    b[0] = false; b[1] = false; b[2] = true; runs += sc;
    log = `${label} ${batter.name} 3루타!${sc ? ` (${sc}점 득점)` : ''}`;
  } else if (res === 'HR') {
    hit = true;
    const sc = 1 + (b[0] ? 1 : 0) + (b[1] ? 1 : 0) + (b[2] ? 1 : 0);
    b[0] = false; b[1] = false; b[2] = false; runs += sc;
    log = `${label} ${batter.name} 홈런! (${sc}점 득점)`;
  }
  return { runs, hit, bases: b, log, isOut: (res === 'K' || res === 'OUT') };
}

/** 접속할 때 보내온 라인업 정보를 검사하고 안전한 값으로 다듬는다 */
export function sanitizeInfo(msg) {
  const cut = (v, n, d) => String(v == null ? d : v).slice(0, n);
  return {
    name: cut(msg.name, 10, '플레이어'),
    teamName: cut(msg.teamName, 20, '무명팀'),
    lineup: Array.isArray(msg.lineup) ? msg.lineup.slice(0, 9).map(b => ({
      name: cut(b && b.name, 12, '선수'),
      contact: clamp(+(b && b.contact) || 60, 1, 99),
      power: clamp(+(b && b.power) || 60, 1, 99),
      speed: clamp(+(b && b.speed) || 60, 1, 99)
    })) : [],
    pitcher: msg.pitcher ? {
      name: cut(msg.pitcher.name, 12, '투수'),
      control: clamp(+msg.pitcher.control || 60, 1, 99),
      stuff: clamp(+msg.pitcher.stuff || 60, 1, 99),
      stamina: clamp(+msg.pitcher.stamina || 60, 1, 99)
    } : { name: '투수', control: 60, stuff: 60, stamina: 60 }
  };
}
