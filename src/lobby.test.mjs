// Node単体テスト（実行: node src/lobby.test.mjs）
import { splitIntoLobbies, lobbySwapCandidates, LOBBY_MODES, remainingPool } from "./lobby.js";

let failed = 0;
function assert(cond, label) {
  if (!cond) { console.error(`FAIL: ${label}`); failed++; }
  else console.log(`ok: ${label}`);
}
// レート 100, 98, ... 62 の20人(p0 が最上位)
const ps = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, r: 100 - i * 2 }));
const ratingOf = (p) => p.r;
const avg = (l) => l.reduce((s, p) => s + p.r, 0) / l.length;
const ids = (l) => l.map((p) => p.id).sort().join();
const shuffled = [...ps].sort(() => Math.random() - 0.5);

assert(LOBBY_MODES.includes("tier") && LOBBY_MODES.includes("mix"), "振り分け方式は tier / mix");

// ---- 実力順: 上位10人が第1試合(上位卓)、下位10人が第2試合(下位卓) ----
const [t1, t2] = splitIntoLobbies(shuffled, "tier", ratingOf);
assert(t1.length === 10 && t2.length === 10, "実力順: 10人ずつ");
assert(ids([...t1, ...t2]) === ids(ps), "実力順: 20人が漏れなく重複なく入る");
assert(Math.min(...t1.map(ratingOf)) > Math.max(...t2.map(ratingOf)), "実力順: 第1試合の最下位 > 第2試合の最上位");

// ---- 混ぜる: 両卓の平均がほぼ同じ ----
const [m1, m2] = splitIntoLobbies(shuffled, "mix", ratingOf);
assert(m1.length === 10 && m2.length === 10, "混ぜる: 10人ずつ");
assert(ids([...m1, ...m2]) === ids(ps), "混ぜる: 20人が漏れなく重複なく入る");
assert(Math.abs(avg(m1) - avg(m2)) <= 1, `混ぜる: 平均の差が1pt以内(実際 ${Math.abs(avg(m1) - avg(m2)).toFixed(2)})`);
assert(Math.abs(avg(m1) - avg(m2)) < Math.abs(avg(t1) - avg(t2)), "混ぜる方が実力順より両卓の平均差が小さい");

// ---- 入力の並び順に左右されない(同じ20人なら同じ結果) ----
const again = splitIntoLobbies([...ps].reverse(), "tier", ratingOf);
assert(ids(again[0]) === ids(t1), "実力順: 入力順に依存しない");
const tie = [{ id: "b", r: 50 }, { id: "a", r: 50 }, { id: "c", r: 50 }, { id: "d", r: 50 }];
assert(ids(splitIntoLobbies(tie, "tier", ratingOf)[0]) === ids(splitIntoLobbies([...tie].reverse(), "tier", ratingOf)[0]), "同点でも結果が決まる");

// ---- 組めない卓があった時の入替候補: レートの近い選手どうしから試す ----
const cands = lobbySwapCandidates(t1, t2, ratingOf);
assert(cands.length === 100, "入替候補は 10×10 通り");
assert(cands[0][0].id === "p9" && cands[0][1].id === "p10", "最初の候補は卓の境目の2人(p9 と p10)");
const gaps = cands.map(([a, b]) => Math.abs(ratingOf(a) - ratingOf(b)));
assert(gaps.every((g, i) => i === 0 || gaps[i - 1] <= g), "候補はレート差の小さい順");

// ---- 第1試合のメンバーを除いた残りの出席者(第2試合を後から組む用) ----
const roster = [
  { id: "a", status: "active" }, { id: "b", status: "active" }, { id: "c", status: "rest" },
  { id: "d", status: "active", adjust: true }, { id: "e", status: "active" },
];
const match1 = { teamA: [{ id: "a" }], teamB: [{ id: "b" }] };
assert(remainingPool(roster, [match1]).map((p) => p.id).join() === "d,e", "残り: 第1試合の出場者と休みを除く(調整枠は含む)");
assert(remainingPool(roster, [match1, null, undefined]).length === 2, "残り: 未編成(null)の試合は無視");
assert(remainingPool(roster, []).length === 4, "残り: 編成が無ければ休み以外の全員");

console.log(failed === 0 ? "\nすべて成功" : `\n${failed}件失敗`);
process.exit(failed === 0 ? 0 : 1);
