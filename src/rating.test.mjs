// Node単体テスト（実行: node src/rating.test.mjs）
import {
  ROLES, initRoles, computeLaneUpdate, applyMatchToPlayers, recomputeAll, effectiveBaseMu,
  isRatedMatch, validateMatchEntries, patchPlayerById,
} from "./rating.js";

let failed = 0;
function assert(cond, label) {
  if (!cond) { console.error(`FAIL: ${label}`); failed++; }
  else console.log(`ok: ${label}`);
}
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// テスト用の選手(全ロール同じ習熟)
function mkPlayer(id, baseMu, prof = "◎", rank = "D4") {
  const profs = Object.fromEntries(ROLES.map((r) => [r, prof]));
  return { id, name: id, rank, baseMu, roles: initRoles(profs, baseMu, false), wins: 0, losses: 0, kdaHistory: [] };
}
// 5対5の試合(A: a1..a5 / B: b1..b5、ロールは ROLES 順)
function mkMatch(id, ts, winner, status = "approved", over = {}) {
  const entries = [
    ...ROLES.map((r, i) => ({ playerId: `a${i + 1}`, team: "A", role: r, champion: "" })),
    ...ROLES.map((r, i) => ({ playerId: `b${i + 1}`, team: "B", role: r, champion: "" })),
  ];
  return { id, timestamp: ts, winner, status, entries, kda: {}, ...over };
}
const team = () => [...[1, 2, 3, 4, 5].map((i) => mkPlayer(`a${i}`, 86)), ...[1, 2, 3, 4, 5].map((i) => mkPlayer(`b${i}`, 86))];

// ==== 現行の計算式の固定(切り出しで挙動を変えていないことの確認) ====
const init = initRoles({ TOP: "◎", JG: "〇", MID: "△", ADC: "×", SUP: "◎" }, 86, false);
assert(init.TOP.mu === 86 && init.JG.mu === 79.1 && init.MID.mu === 73.1 && init.ADC.mu === 64.5, "初期値: D4 の習熟度補正(◎86.0 / 〇79.1 / △73.1 / ×64.5)");
assert(init.TOP.sigma === 20 && init.MID.sigma === 22 && init.ADC.sigma === 24, "初期σ: ◎20 / △22 / ×24");
assert(effectiveBaseMu({ baseMu: 82, honorRank: "D4" }) === 86, "名誉レートが基準値に優先");
const { results } = computeLaneUpdate(mkMatch("m", 1, "A").entries, team(), "A");
assert(results.a1.delta > 1.5 && results.a1.delta < 2.5, `互角の対面で1勝 ≈ +2pt(実測 ${results.a1.delta.toFixed(2)})`);
assert(close(results.a1.delta, -results.b1.delta), "互角なら勝ちと負けの変動は対称");
const after1 = applyMatchToPlayers(team(), mkMatch("m1", 1, "A"));
assert(after1.find((p) => p.id === "a1").wins === 1 && after1.find((p) => p.id === "b1").losses === 1, "勝敗数の加算");
assert(after1.find((p) => p.id === "a1").kdaHistory.length === 1, "試合履歴の追加");
const r2 = recomputeAll(team(), [mkMatch("m2", 2, "B"), mkMatch("m1", 1, "A")]);
const r2b = applyMatchToPlayers(applyMatchToPlayers(team(), mkMatch("m1", 1, "A")), mkMatch("m2", 2, "B"));
assert(close(r2.find((p) => p.id === "a1").roles.TOP.mu, r2b.find((p) => p.id === "a1").roles.TOP.mu), "再計算は時系列順に適用");

// ==== 不具合1: 試合削除時の再計算に承認待ちの試合が混ざる ====
assert(isRatedMatch({ status: "approved" }) && !isRatedMatch({ status: "pending" }), "承認済みだけがレート対象");
assert(isRatedMatch({}), "status の無い旧データは承認済み扱い");
const withPending = recomputeAll(team(), [mkMatch("m1", 1, "A"), mkMatch("p1", 2, "A", "pending")]);
const onlyApproved = recomputeAll(team(), [mkMatch("m1", 1, "A")]);
assert(close(withPending.find((p) => p.id === "a1").roles.TOP.mu, onlyApproved.find((p) => p.id === "a1").roles.TOP.mu), "承認待ちの試合を渡してもレートに入らない");
assert(withPending.find((p) => p.id === "a1").wins === 1, "承認待ちの試合は勝敗数にも入らない");

// ==== 不具合3: 人数違い・ロール重複の試合を報告できてしまう ====
const ok = validateMatchEntries(mkMatch("v", 1, "A").entries);
assert(ok.length === 0, "5対5・ロール重複なしはOK");
const allMid = mkMatch("v", 1, "A").entries.map((e) => ({ ...e, role: "MID" }));
assert(validateMatchEntries(allMid).some((e) => e.code === "dupRole" && e.team === "A" && e.role === "MID"), "全員MID(手入力の既定値のまま)はロール重複");
const four = mkMatch("v", 1, "A").entries.filter((e) => e.playerId !== "a5");
assert(validateMatchEntries(four).some((e) => e.code === "teamSize" && e.team === "A" && e.count === 4), "4対5は人数エラー");
const twice = mkMatch("v", 1, "A").entries.map((e) => (e.playerId === "b1" ? { ...e, playerId: "a1" } : e));
assert(validateMatchEntries(twice).some((e) => e.code === "dupPlayer" && e.playerId === "a1"), "同じ選手が両チームにいるのはエラー");

// ==== 不具合2: 同時に操作すると他人の変更が消える(全員分を手元の状態で上書きしていた) ====
// サーバー上の最新の配列に「その選手だけ」の変更を当てる関数で書き込む
const server = [{ id: "x", status: "active", memo: "" }, { id: "y", status: "rest", memo: "遅れます" }];
const patched = patchPlayerById(server, "x", (p) => ({ ...p, status: "rest" }));
assert(patched[0].status === "rest" && patched[1].memo === "遅れます" && patched[1].status === "rest", "他の選手の最新の値は保ったまま自分だけ変更");
assert(server[0].status === "active", "元の配列は書き換えない");
assert(patchPlayerById(server, "nobody", (p) => p) === null, "対象がいなければ null(書き込まない)");

console.log(failed === 0 ? "\nすべて成功" : `\n${failed}件失敗`);
process.exit(failed === 0 ? 0 : 1);
