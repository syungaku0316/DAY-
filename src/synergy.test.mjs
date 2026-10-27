// Node単体テスト（実行: node src/synergy.test.mjs）
import { matchExpectations, allyPairs, roleComboKey } from "./synergy.js";
import { ROLES, initRoles, recomputeAll } from "./rating.js";

let failed = 0;
function assert(cond, label) {
  if (!cond) { console.error(`FAIL: ${label}`); failed++; }
  else console.log(`ok: ${label}`);
}

const mkPlayer = (id, base) => ({
  id, name: id, rank: "G1", baseMu: base, status: "active", prefRoles: [], wins: 0, losses: 0, kdaHistory: [],
  roles: initRoles({ TOP: "◎", JG: "◎", MID: "◎", ADC: "◎", SUP: "◎" }, base, false),
});
// 10人: a0..a4 がブルー、b0..b4 がレッド。ロールは並び順
const ids = ["a0", "a1", "a2", "a3", "a4", "b0", "b1", "b2", "b3", "b4"];
let ts = 0;
const mkMatch = (blue, red, winner, roleOrder = ROLES) => ({
  id: `m${++ts}`, status: "approved", timestamp: ts, winner,
  entries: [...blue.map((id, i) => ({ playerId: id, team: "A", role: roleOrder[i] })), ...red.map((id, i) => ({ playerId: id, team: "B", role: roleOrder[i] }))],
});

// ---- 予想勝率: 互角なら50%、ブルーが強ければ50%超 ----
{
  const ps = ids.map((id) => mkPlayer(id, 60));
  const m1 = mkMatch(ids.slice(0, 5), ids.slice(5), "A");
  const { exps, skipped } = matchExpectations(ps, [m1]);
  assert(exps.length === 1 && skipped === 0, "1試合を集計");
  assert(Math.abs(exps[0].pA - 0.5) < 1e-9, `全員同じレートなら予想勝率50%。実際 ${exps[0].pA}`);

  const strong = ids.map((id) => mkPlayer(id, id.startsWith("a") ? 90 : 60));
  const e2 = matchExpectations(strong, [mkMatch(ids.slice(0, 5), ids.slice(5), "A")]).exps[0];
  assert(e2.pA > 0.6, `ブルーが強ければ予想勝率は高い。実際 ${(e2.pA * 100).toFixed(1)}%`);
}

// ---- 試合を重ねると直前のレートが使われる(再生の順序) ----
{
  const ps = ids.map((id) => mkPlayer(id, 60));
  const ms = [mkMatch(ids.slice(0, 5), ids.slice(5), "A"), mkMatch(ids.slice(0, 5), ids.slice(5), "A")];
  const { exps } = matchExpectations(ps, ms);
  assert(exps[0].pA === 0.5 && exps[1].pA > 0.5, "1試合目に勝ったブルーは2試合目の予想勝率が上がる");
  // 最後まで再生した結果は recomputeAll と一致する(初期化が同じ)
  const after = recomputeAll(ps, ms);
  assert(after.find((p) => p.id === "a0").roles.TOP.mu > 60, "再生の初期化は recomputeAll と同じ前提");
}

// ---- 集計できない試合 ----
{
  const ps = ids.filter((id) => id !== "b4").map((id) => mkPlayer(id, 60)); // b4 は削除済み
  const pending = { ...mkMatch(ids.slice(0, 5), ids.slice(5), "A"), status: "pending" };
  const { exps, skipped } = matchExpectations(ps, [mkMatch(ids.slice(0, 5), ids.slice(5), "A"), pending]);
  assert(exps.length === 0 && skipped === 1, `削除済み選手を含む試合は除外(承認待ちは数えない)。実際 ${skipped}`);
}

// ---- 味方ペア ----
{
  const ps = ids.map((id) => mkPlayer(id, 60));
  const ms = [
    mkMatch(ids.slice(0, 5), ids.slice(5), "A"),
    mkMatch(ids.slice(0, 5), ids.slice(5), "A"),
    mkMatch(ids.slice(0, 5), ids.slice(5), "B"),
    // 4試合目は a0 と a1 のロールを入れ替え
    mkMatch(["a1", "a0", "a2", "a3", "a4"], ids.slice(5), "A"),
  ];
  const { exps } = matchExpectations(ps, ms);
  const all = allyPairs(exps, { minGames: 3 });
  const p01 = all.find((r) => r.a === "a0" && r.b === "a1");
  assert(p01 && p01.n === 4 && p01.wins === 3, `a0×a1 は4試合3勝。実際 ${p01 && p01.wins}/${p01 && p01.n}`);
  assert(Math.abs(p01.diff - (p01.wr - p01.exp)) < 1e-12 && p01.exp > 0 && p01.exp < 1, "予想との差 = 実勝率 − 平均予想勝率");
  assert(p01.roleMix["TOP×JG"] === 3 && p01.roleMix["JG×TOP"] === 1, "ロールの内訳を数える(選手ID順で並べたロール)");
  assert(all.length === 20, `ブルー10組+レッド10組 = 20組(全員3試合以上)。実際 ${all.length}`);

  const byRole = allyPairs(exps, { byRole: true, minGames: 3 });
  const r01 = byRole.find((r) => r.a === "a0" && r.b === "a1");
  assert(r01 && r01.ra === "TOP" && r01.rb === "JG" && r01.n === 3, "ロールを区別すると a0(TOP)×a1(JG) は3試合、入れ替えた1試合は別の組(3試合未満で除外)");
  assert(allyPairs(exps, { byRole: true, minGames: 1 }).some((r) => r.a === "a0" && r.ra === "JG" && r.rb === "TOP" && r.n === 1), "下限1なら入れ替えた組も出る");
}

assert(roleComboKey("SUP", "ADC") === "ADC×SUP" && roleComboKey("JG", "TOP") === "TOP×JG", "ロールの組は ROLES 順で順不同キー");

console.log(failed ? `\n${failed} 件失敗` : "\nすべて成功");
process.exit(failed ? 1 : 0);
