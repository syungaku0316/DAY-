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

// 試合 match の固定で、物理的に組めない指定を原因つきで返す(編成前に止めて、汎用の「割当不能」にしないため)。
// tooMany: 固定が10人超 / teamOver: 同じチームに6人以上 / roleOver: 同じレーンに3人以上 / laneDup: 同じチームの同じレーンに2人
export function pinIssues(players, prefOf, match) {
  const list = players.filter((p) => isPinnedFor(prefOf(p), match)).map((p) => prefOf(p));
  const out = [];
  if (list.length > 10) out.push({ code: "tooMany", match, n: list.length });
  const count = (fn) => list.reduce((m, pf) => { const k = fn(pf); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
  const fixed = (v) => (v && v !== "AUTO" ? v : null);
  Object.entries(count((pf) => fixed(pf.team))).forEach(([team, n]) => { if (n > 5) out.push({ code: "teamOver", match, team, n }); });
  Object.entries(count((pf) => fixed(pf.role))).forEach(([role, n]) => { if (n > 2) out.push({ code: "roleOver", match, role, n }); });
  Object.entries(count((pf) => (fixed(pf.team) && fixed(pf.role) ? `${pf.team}_${pf.role}` : null))).forEach(([k, n]) => {
    if (n > 1) { const [team, role] = k.split("_"); out.push({ code: "laneDup", match, team, role, n }); }
  });
  return out;
}

// 2試合同時の卓分け(固定あり)。まず通常どおり分け、固定した試合と違う卓に入った人を移す。
// 移す相手は、固定違いどうし → 相手卓の固定していない人のうちレートの近い人、の順(卓分けの方針をなるべく崩さない)。
// pinnedMatch(p): その人を固定した試合(1/2)。固定なしは null。各試合の固定は10人以下である前提
export function splitWithPins(players, mode, ratingOf, pinnedMatch) {
  let [l1, l2] = splitIntoLobbies(players, mode, ratingOf);
  const wrong1 = l2.filter((p) => pinnedMatch(p) === 1); // 第1試合に固定したのに第2試合の卓にいる
  const wrong2 = l1.filter((p) => pinnedMatch(p) === 2);
  // a(第1試合の卓) と b(第2試合の卓) を入れ替える
  const swap = (a, b) => { l1 = l1.map((x) => (x === a ? b : x)); l2 = l2.map((x) => (x === b ? a : x)); };
  const closest = (cands, target) => [...cands].sort((x, y) => Math.abs(ratingOf(x) - ratingOf(target)) - Math.abs(ratingOf(y) - ratingOf(target))
    || String(x.id).localeCompare(String(y.id)))[0];
  while (wrong1.length && wrong2.length) swap(wrong2.shift(), wrong1.shift());
  wrong1.forEach((b) => swap(closest(l1.filter((p) => !pinnedMatch(p)), b), b));
  wrong2.forEach((a) => swap(a, closest(l2.filter((p) => !pinnedMatch(p)), a)));
  return [l1, l2];
}

// 事前固定を変えた時に作り直しが必要な試合(変わった人の、変更前・変更後それぞれの固定先の試合)。
// 第2試合の固定を変えただけで、組んであった第1試合の結果まで消さないようにする
export function pinChangeClears(prevPrefs, nextPrefs) {
  const out = { match1: false, match2: false };
  const ids = new Set([...Object.keys(prevPrefs || {}), ...Object.keys(nextPrefs || {})]);
  ids.forEach((id) => {
    const a = (prevPrefs || {})[id], b = (nextPrefs || {})[id];
    if (JSON.stringify(a || null) === JSON.stringify(b || null)) return;
    [a, b].forEach((pref) => {
      if (isPinnedFor(pref, 1)) out.match1 = true;
      if (isPinnedFor(pref, 2)) out.match2 = true;
    });
  });
  return out;
}

// NGレーン等でどちらかの卓が組めなかった時に試す、卓をまたいだ1対1の入替候補。
// レートの近い2人から順に試し、卓分けの方針(実力順/混ぜる)をなるべく崩さない
export function lobbySwapCandidates(l1, l2, ratingOf) {
  const out = [];
  l1.forEach((a) => l2.forEach((b) => out.push([a, b])));
  return out.sort((x, y) => Math.abs(ratingOf(x[0]) - ratingOf(x[1])) - Math.abs(ratingOf(y[0]) - ratingOf(y[1]))
    || String(x[0].id).localeCompare(String(y[0].id)) || String(x[1].id).localeCompare(String(y[1].id)));
}
