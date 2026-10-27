// 相性ランキング: 同じチームになった2人の組み合わせごとに、実際の勝率と「試合前レートからの予想勝率」を比べる純粋関数。
// 生の勝率だけだと「強い人とよく組む人」が相性に関係なく高く見えるため、予想との差(実勝率 − 予想勝率)で
// メンバーの強さを差し引いた相性を出す。予想勝率はチーム分けの勝率予想(teamWinProb)と同じ式。
import { ROLES, BETA, TAU, initRoles, effectiveBaseMu, applyMatchToPlayers, isRatedMatch } from "./rating.js";

// 承認済みの全試合を時系列に再生し、各試合の直前のレート(ロール別μ・σ)からブルー(A)の勝率予想を求める。
// 初期化は recomputeAll と同じ(登録時のランク・習熟度から)。10人揃わない・選手が削除済み・勝者不明の試合は skipped
function matchExpectations(players, matches) {
  let ps = (players || []).map((p) => {
    const profMap = {};
    ROLES.forEach((r) => { profMap[r] = p.roles[r].prof; });
    const unranked = p.rank === "アンランク" || p.rank === "初心者" || !p.rank;
    return { ...p, roles: initRoles(profMap, effectiveBaseMu(p), unranked), wins: 0, losses: 0, kdaHistory: [] };
  });
  const out = [];
  let skipped = 0;
  (matches || []).filter(isRatedMatch).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).forEach((m) => {
    const ents = m.entries || [];
    const lanes = ents.map((e) => {
      const p = ps.find((x) => x.id === e.playerId);
      const r = p && p.roles[e.role];
      return r && (e.team === "A" || e.team === "B") ? { e, mu: r.mu, sigma: r.sigma } : null;
    });
    if (ents.length === ROLES.length * 2 && lanes.every(Boolean) && (m.winner === "A" || m.winner === "B")) {
      const sumMu = (team) => lanes.filter((x) => x.e.team === team).reduce((s, x) => s + x.mu, 0);
      const v = lanes.reduce((s, x) => s + x.sigma ** 2 + TAU ** 2, 0) + 10 * BETA * BETA;
      const pA = 1 / (1 + Math.exp((sumMu("B") - sumMu("A")) / Math.sqrt(v)));
      out.push({ id: m.id, ts: m.timestamp || 0, winner: m.winner, pA, entries: ents.map((e) => ({ playerId: e.playerId, team: e.team, role: e.role })) });
    } else {
      skipped++;
    }
    ps = applyMatchToPlayers(ps, m);
  });
  return { exps: out, skipped };
}

// 味方ペアの集計。byRole=true なら「誰がどのロール×誰がどのロール」を別の組として数える。
// 返す行: { a, b(選手ID、a<b), ra, rb(byRole時のロール), n, wins, wr, exp(平均予想勝率), diff(wr−exp), roleMix({"JG×MID": 回数}) }
function allyPairs(exps, { byRole = false, minGames = 3 } = {}) {
  const map = new Map();
  exps.forEach((x) => ["A", "B"].forEach((team) => {
    const mem = x.entries.filter((e) => e.team === team).sort((p, q) => (p.playerId < q.playerId ? -1 : p.playerId > q.playerId ? 1 : 0));
    const pExp = team === "A" ? x.pA : 1 - x.pA;
    const won = x.winner === team;
    for (let i = 0; i < mem.length; i++) {
      for (let j = i + 1; j < mem.length; j++) {
        const p = mem[i];
        const q = mem[j];
        const key = byRole ? `${p.playerId}@${p.role}|${q.playerId}@${q.role}` : `${p.playerId}|${q.playerId}`;
        let s = map.get(key);
        if (!s) {
          s = { a: p.playerId, b: q.playerId, ra: byRole ? p.role : null, rb: byRole ? q.role : null, n: 0, wins: 0, expSum: 0, roleMix: {} };
          map.set(key, s);
        }
        s.n++;
        if (won) s.wins++;
        s.expSum += pExp;
        const mix = `${p.role}×${q.role}`;
        s.roleMix[mix] = (s.roleMix[mix] || 0) + 1;
      }
    }
  }));
  return [...map.values()]
    .filter((s) => s.n >= minGames)
    .map(({ expSum, ...s }) => {
      const wr = s.wins / s.n;
      const exp = expSum / s.n;
      return { ...s, wr, exp, diff: wr - exp };
    });
}

// 2つのロールの組を順不同で表すキー(フィルタ用)。例: roleComboKey("SUP", "ADC") === "ADC×SUP"
const roleComboKey = (r1, r2) => [r1, r2].sort((x, y) => ROLES.indexOf(x) - ROLES.indexOf(y)).join("×");

export { matchExpectations, allyPairs, roleComboKey };
