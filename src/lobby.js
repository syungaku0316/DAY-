// 2試合同時マッチング用の卓分け(純関数)。単体テスト: node src/lobby.test.mjs
// 選出済みの20人を第1試合・第2試合の10人ずつに分ける。各卓の中のチーム分けは既存の自動編成(bestBalancedSplit)で行う。

// tier: 実力順(上位10人=第1試合 / 下位10人=第2試合)。各試合の中の実力差が小さくなる
// mix : 混ぜる(スネーク順で交互に配る)。両試合の平均レートがほぼ同じになる
export const LOBBY_MODES = ["tier", "mix"];

// レートの高い順(同点はID順)。入力の並び順に結果が左右されないようにする
const byRating = (players, ratingOf) =>
  [...players].sort((a, b) => ratingOf(b) - ratingOf(a) || String(a.id).localeCompare(String(b.id)));

export function splitIntoLobbies(players, mode, ratingOf) {
  const sorted = byRating(players, ratingOf);
  const half = Math.floor(sorted.length / 2);
  if (mode === "mix") {
    // 1,2,2,1,1,2,2,1… の順に配る(上から順に交互に配るより平均が揃う)
    const l1 = [], l2 = [];
    sorted.forEach((p, i) => ((i % 4 === 0 || i % 4 === 3) ? l1 : l2).push(p));
    return [l1, l2];
  }
  return [sorted.slice(0, half), sorted.slice(half)];
}

// 編成済みの試合(results: チーム分け結果の配列。null は無視)に出ていない出席者(休み以外)。
// 第1試合を組んだ後に、残りのメンバーで第2試合を組むときの候補になる
export function remainingPool(players, results) {
  const taken = new Set(results.filter((r) => r && r.teamA).flatMap((r) => [...r.teamA, ...r.teamB]).map((x) => x.id));
  return players.filter((p) => p.status !== "rest" && !taken.has(p.id));
}

// 事前固定(session.prefs[選手ID] = {team, role, force, match})をどの試合に使うか。match 未指定は第1試合
export const pinMatchOf = (pref) => (pref && pref.match === 2 ? 2 : 1);
// その試合の固定か(チームかロールの少なくとも一方が「おまかせ」以外。控え指定は固定に数えない)
export function isPinnedFor(pref, match) {
  if (!pref || pref.force === "bench") return false;
  const pinned = (pref.team && pref.team !== "AUTO") || (pref.role && pref.role !== "AUTO");
  return !!pinned && pinMatchOf(pref) === match;
}
// 試合 match を組むときの候補: 出席者のうち、編成済みの試合(results)に出ておらず、もう一方の試合に固定されていない人
export function poolForMatch(players, prefs, match, results) {
  const other = match === 1 ? 2 : 1;
  return remainingPool(players, results).filter((p) => !isPinnedFor((prefs || {})[p.id], other));
}

// NGレーン等でどちらかの卓が組めなかった時に試す、卓をまたいだ1対1の入替候補。
// レートの近い2人から順に試し、卓分けの方針(実力順/混ぜる)をなるべく崩さない
export function lobbySwapCandidates(l1, l2, ratingOf) {
  const out = [];
  l1.forEach((a) => l2.forEach((b) => out.push([a, b])));
  return out.sort((x, y) => Math.abs(ratingOf(x[0]) - ratingOf(x[1])) - Math.abs(ratingOf(y[0]) - ratingOf(y[1]))
    || String(x[0].id).localeCompare(String(y[0].id)) || String(x[1].id).localeCompare(String(y[1].id)));
}
