// Node単体テスト（実行: node src/lobby.test.mjs）
import { splitIntoLobbies, lobbySwapCandidates, LOBBY_MODES, remainingPool, pinMatchOf, isPinnedFor, poolForMatch, splitWithPins, pinChangeClears, pinIssues } from "./lobby.js";

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

// ---- 事前固定(レーン固定・対面指定)をどの試合に使うか ----
assert(pinMatchOf({ team: "A" }) === 1 && pinMatchOf({ team: "A", match: 2 }) === 2, "固定の試合: 指定なしは第1試合");
assert(isPinnedFor({ team: "A", role: "TOP" }, 1) && !isPinnedFor({ team: "A", role: "TOP" }, 2), "第1試合の固定");
assert(isPinnedFor({ team: "AUTO", role: "MID", match: 2 }, 2), "ロールだけの固定も固定");
assert(!isPinnedFor({ team: "AUTO", role: "AUTO", match: 2 }, 2), "両方おまかせは固定ではない");
assert(!isPinnedFor({ team: "A", force: "bench", match: 1 }, 1), "控え指定は固定に数えない");
assert(!isPinnedFor(undefined, 1), "設定なし");

const pinRoster = [
  { id: "a", status: "active" }, { id: "b", status: "active" }, { id: "c", status: "active" },
  { id: "d", status: "active" }, { id: "r", status: "rest" },
];
const pins = { a: { team: "A", role: "TOP" }, b: { team: "B", role: "TOP", match: 2 }, r: { team: "A", match: 2 } };
assert(poolForMatch(pinRoster, pins, 1, []).map((p) => p.id).join() === "a,c,d", "第1試合の候補: 第2試合に固定した人(b)と休みを除く");
const g1 = { teamA: [{ id: "a" }], teamB: [{ id: "c" }] };
assert(poolForMatch(pinRoster, pins, 2, [g1]).map((p) => p.id).join() === "b,d", "第2試合の候補: 第1試合の出場者を除き、第2試合の固定(b)は含む");
const pinsA1 = { ...pins, d: { team: "A", match: 1 } };
assert(poolForMatch(pinRoster, pinsA1, 2, [g1]).map((p) => p.id).join() === "b", "第2試合の候補: 第1試合に固定したが出ていない人(d)も除く");


// ---- 2試合同時の編成でも固定を守る: 固定した人は固定した試合の卓に入れる ----
// p0..p19(p0 が最上位)。p1 を第2試合に、p18・p19 を第1試合に固定
const pinOf = { p1: 2, p18: 1, p19: 1 };
const pinnedMatch = (p) => pinOf[p.id] || null;
for (const mode of ["tier", "mix"]) {
  const [q1, q2] = splitWithPins(shuffled, mode, ratingOf, pinnedMatch);
  assert(q1.length === 10 && q2.length === 10 && ids([...q1, ...q2]) === ids(ps), `固定あり(${mode}): 10人ずつ・漏れなし`);
  assert(q1.some((p) => p.id === "p18") && q1.some((p) => p.id === "p19") && q2.some((p) => p.id === "p1"), `固定あり(${mode}): 固定した人は固定した試合に入る`);
}
// 実力順は固定のために動かす人をレートの近い人に限る(方針をなるべく崩さない)
const [k1, k2] = splitWithPins(shuffled, "tier", ratingOf, pinnedMatch);
const moved = ps.filter((p) => !pinOf[p.id]).filter((p) => (k1.includes(p) ? 1 : 2) !== (t1.includes(p) ? 1 : 2));
assert(moved.map((p) => p.id).join() === "p9", `実力順: 固定していない人で卓を移るのは、境目に近いp9の1人だけ(実際 ${moved.map((p) => p.id).join()})`);
const noPin = splitWithPins(shuffled, "tier", ratingOf, () => null);
assert(ids(noPin[0]) === ids(t1), "固定なしなら通常の卓分けと同じ");

// ---- 固定を変えた時に消すチーム分け結果: 影響する試合だけ ----
const before = { a: { team: "A", role: "TOP", match: 1 }, b: { team: "B", match: 2 } };
assert(JSON.stringify(pinChangeClears(before, { ...before, b: { team: "A", match: 2 } })) === JSON.stringify({ match1: false, match2: true }), "第2試合の固定を変えても第1試合は消さない");
assert(pinChangeClears(before, { ...before, a: { team: "B", role: "TOP", match: 1 } }).match1, "第1試合の固定を変えたら第1試合を作り直す");
assert(JSON.stringify(pinChangeClears(before, { ...before, a: { team: "A", role: "TOP", match: 2 } })) === JSON.stringify({ match1: true, match2: true }), "第1試合→第2試合への付け替えは両方");
assert(JSON.stringify(pinChangeClears(before, { ...before, c: { team: "AUTO", role: "AUTO" } })) === JSON.stringify({ match1: false, match2: false }), "固定でない設定の追加はどちらも消さない");
assert(pinChangeClears(before, { b: before.b }).match1, "第1試合の固定の解除は第1試合を作り直す");


// ---- 組めない固定の指定を、編成前に原因つきで検出する ----
const P = (id, pref) => ({ id, pref });
const issues = (list, match) => pinIssues(list.map((x) => ({ id: x.id })), (p) => list.find((x) => x.id === p.id).pref, match);
const sixA = ["a", "b", "c", "d", "e", "f"].map((id) => P(id, { team: "A" }));
assert(issues(sixA, 1).some((e) => e.code === "teamOver" && e.team === "A" && e.n === 6), "同じ試合で同じチームに6人固定は組めない");
assert(!issues(sixA.slice(0, 5), 1).length, "同じチームに5人までは組める");
const threeTop = ["a", "b", "c"].map((id) => P(id, { role: "TOP" }));
assert(issues(threeTop, 1).some((e) => e.code === "roleOver" && e.role === "TOP" && e.n === 3), "同じ試合でTOPに3人固定は組めない");
const twoTopA = [P("a", { team: "A", role: "TOP" }), P("b", { team: "A", role: "TOP" })];
assert(issues(twoTopA, 1).some((e) => e.code === "laneDup" && e.team === "A" && e.role === "TOP"), "同じチームの同じレーンに2人は組めない");
const topAndAuto = [P("a", { team: "A", role: "TOP" }), P("b", { role: "TOP" }), P("c", { team: "B", role: "TOP" })];
assert(issues(topAndAuto, 1).some((e) => e.code === "roleOver"), "チーム指定なしのTOPを含めて3人ならTOP超過");
const eleven = Array.from({ length: 11 }, (_, i) => P(`x${i}`, { team: i % 2 ? "A" : "B" }));
assert(issues(eleven, 1).some((e) => e.code === "tooMany" && e.n === 11), "1試合に11人固定は組めない");
const other = [...sixA.map((x) => ({ ...x, pref: { ...x.pref, match: 2 } }))];
assert(!issues(other, 1).length && issues(other, 2).length, "固定の検査は試合ごと");

console.log(failed === 0 ? "\nすべて成功" : `\n${failed}件失敗`);
process.exit(failed === 0 ? 0 : 1);
