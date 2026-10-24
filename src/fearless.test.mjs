// Node単体テスト（実行: node src/fearless.test.mjs）
import {
  toTenths, isMasterPlusAuto, snapshotMember, snapshotSub, lineupTenths, validateTeam, validateLineup,
  orderTeams, buildSchedule, seriesState, resolveBracket, finalPlacements, fearlessLocked, fearlessConflicts,
  sideChooser, subRoleUsage, tournamentStats, drawSeeds, drawSurvivors, hasAnyResult, starterLineup,
  normalizeRules, fearlessBlocked, findDraftRecord, splitChampList, isEntryOpen,
} from "./fearless.js";

let failed = 0;
function assert(cond, label) {
  if (!cond) { console.error(`FAIL: ${label}`); failed++; }
  else console.log(`ok: ${label}`);
}
const has = (res, code) => res.errors.some((e) => e.code === code);

const RULES = { pointCap: 430, maxMasterPlus: 1, maxSubs: 2 };
const R = ["TOP", "JG", "MID", "ADC", "SUP"];
// pts配列から先発チームを作る
function mkTeam(id, pts, opts = {}) {
  const members = {};
  R.forEach((r, i) => { members[r] = { playerId: `${id}-${r}`, name: `${id}${r}`, pts: pts[i] }; });
  return { id, name: id, createdAt: opts.createdAt || 0, members, subs: opts.subs || {}, mplus: opts.mplus || {} };
}

// ---- 基本 ----
assert(toTenths(86.04999) === 860, "toTenths: 丸め");
assert(isMasterPlusAuto({ rank: "マスター" }), "M+: 申告ランク");
assert(isMasterPlusAuto({ rank: "D1", honorRank: "グランドマスター" }), "M+: 名誉レート");
assert(!isMasterPlusAuto({ rank: "D1" }), "M+: D1は対象外");
const pl = { id: "p1", name: "A", roles: { TOP: { mu: 84.26 }, JG: { mu: 70 }, MID: { mu: 60 }, ADC: { mu: 50 }, SUP: { mu: 40 } } };
assert(snapshotMember(pl, "TOP").pts === 84.3, "snapshotMember: 小数第1位");
assert(snapshotSub(pl).pts.SUP === 40, "snapshotSub: 全ロール");

// ---- 上限判定(浮動小数) ----
const t430 = mkTeam("A", [86.1, 86.2, 85.9, 85.9, 85.9]); // 合計 430.0
assert(validateTeam(t430, RULES).ok, "上限ちょうど430はOK");
assert(validateTeam(t430, RULES).total10 === 4300, "合計は整数(0.1pt単位)");
const t4301 = mkTeam("A", [86.1, 86.2, 85.9, 85.9, 86.0]);
assert(has(validateTeam(t4301, RULES), "overCap"), "430.1はoverCap");
const tFloat = mkTeam("A", [0.1, 0.2, 0.1, 429.5, 0.1]); // 浮動小数の和だと 430.00000000000006 になり得る
assert(validateTeam(tFloat, RULES).ok, "浮動小数の誤差で上限超過にならない");

// ---- M+ ----
const tM = mkTeam("A", [80, 80, 80, 80, 80], { mplus: { "A-TOP": true, "A-JG": true } });
assert(has(validateTeam(tM, RULES), "mplusOver"), "M+2人でmplusOver");
const tM1 = { ...tM, mplus: { "A-TOP": true } };
assert(!has(validateTeam(tM1, RULES), "mplusOver"), "手動補正で1人ならOK");

// ---- 重複・補欠数・空き ----
const tDup = mkTeam("A", [80, 80, 80, 80, 80]);
tDup.members.JG = { ...tDup.members.TOP };
assert(has(validateTeam(tDup, RULES), "dupInTeam"), "同一選手のチーム内重複");
const tOther = mkTeam("B", [80, 80, 80, 80, 80]);
tOther.members.TOP = { playerId: "A-MID", name: "x", pts: 80 };
assert(has(validateTeam(mkTeam("A", [80, 80, 80, 80, 80]), RULES, [tOther]), "dupOtherTeam"), "他チームとの重複");
const subs3 = { s1: { playerId: "s1", pts: {} }, s2: { playerId: "s2", pts: {} }, s3: { playerId: "s3", pts: {} } };
assert(has(validateTeam(mkTeam("A", [80, 80, 80, 80, 80], { subs: subs3 }), RULES), "tooManySubs"), "補欠3人で超過");
const tEmpty = mkTeam("A", [80, 80, 80, 80, 80]); delete tEmpty.members.SUP;
assert(has(validateTeam(tEmpty, RULES), "slotEmpty"), "空きスロット");

// ---- 補欠出場 ----
const sub = { playerId: "S", name: "S", pts: { TOP: 95, JG: 60, MID: 60, ADC: 60, SUP: 60 } };
const tSub = mkTeam("A", [80, 80, 80, 80, 80], { subs: { S: sub } });
const luTop = { ...starterLineup(tSub), TOP: "S" };
assert(lineupTenths(tSub, luTop) === 4150, "補欠TOPは補欠のTOPポイントで計算");
assert(validateLineup(tSub, luTop, RULES).ok, "補欠TOP 415はOK");
assert(has(validateLineup(tSub, { ...starterLineup(tSub), JG: "S" }, RULES, { S: "TOP" }), "subRoleLocked"), "補欠は同日に別ロール不可");
assert(!has(validateLineup(tSub, luTop, RULES, { S: "TOP" }), "subRoleLocked"), "同じロールなら可");
const tSubHi = mkTeam("A", [86, 86, 86, 86, 86], { subs: { S: sub } });
assert(has(validateLineup(tSubHi, { ...starterLineup(tSubHi), TOP: "S" }, RULES), "overCap"), "補欠出場で上限超過");
assert(validateTeam(tSubHi, RULES).warnings.some((w) => w.code === "subOverRisk"), "登録時に補欠の超過リスクを警告");
assert(has(validateLineup(tSub, { ...starterLineup(tSub), TOP: "A-JG", JG: "S" }, RULES), "notInTeam"), "先発の別ロール起用は不可");

// ---- 対戦表 ----
const teams = [mkTeam("A", [80, 80, 80, 80, 80], { createdAt: 1 }), mkTeam("B", [80, 80, 80, 80, 80], { createdAt: 2 }),
  mkTeam("C", [80, 80, 80, 80, 80], { createdAt: 3 }), mkTeam("D", [80, 80, 80, 80, 80], { createdAt: 4 })];
assert(buildSchedule(teams.slice(0, 1), RULES).mode === "none", "1チームは対戦表なし");
const duo = buildSchedule(teams.slice(0, 2), RULES);
assert(duo.mode === "duo" && duo.series.length === 2 && duo.series[0].bestOf === 3 && duo.series[1].bestOf === 5, "2チーム→スクリムBO3+本番BO5");
const s3 = buildSchedule(teams.slice(0, 3), RULES);
assert(s3.mode === "draw" && s3.drawTo === 2, "3チーム→抽選で2");
assert(buildSchedule([...teams, mkTeam("E", [1, 1, 1, 1, 1])], RULES).drawTo === 4, "5チーム→抽選で4");
const se = buildSchedule(teams, RULES);
assert(se.mode === "se4" && se.series[0].a === "A" && se.series[0].b === "D" && se.series[1].a === "B" && se.series[1].b === "C", "4チーム→準決勝 1v4・2v3");
const ordered = orderTeams({ A: teams[0], B: { ...teams[1], eliminated: true }, C: teams[2] }, ["C", "A"]);
assert(ordered.map((x) => x.id).join() === "C,A", "orderTeams: 抽選落ち除外・シード順");

// ---- シリーズ・ブラケット ----
const g = (no, blue, red, winner, picks = {}) => ({ no, blue, red, winner, picks });
const sm = {
  sf1: { games: { g1: g(1, "A", "D", "A"), g2: g(2, "D", "A", "A") } },
  sf2: { games: { g1: g(1, "B", "C", "C"), g2: g(2, "B", "C", "B") } },
};
const res1 = resolveBracket(se.series, sm);
assert(res1[0].state.done && res1[0].state.winner === "A" && res1[0].state.nextNo === null, "BO3 2-0で終了、第3試合不要");
assert(!res1[1].state.done && res1[1].state.nextNo === 3, "1-1は第3試合へ");
assert(res1[2].a === "A" && res1[2].b === null, "未決着の準決勝側は決勝未定(決着側は埋まる)");
sm.sf2.games.g3 = g(3, "C", "B", "C");
const res2 = resolveBracket(se.series, sm);
assert(res2[2].a === "A" && res2[2].b === "C" && res2[3].a === "D" && res2[3].b === "B", "勝者→決勝、敗者→3位決定戦");
assert(hasAnyResult(sm) && !hasAnyResult({}), "hasAnyResult");
sm.final = { games: { g1: g(1, "A", "C", "C"), g2: g(2, "A", "C", "C"), g3: g(3, "A", "C", "C") } };
sm.third = { games: { g1: g(1, "D", "B", "D"), g2: g(2, "D", "B", "D"), g3: g(3, "D", "B", "D") } };
const pl4 = finalPlacements("se4", resolveBracket(se.series, sm));
assert(pl4.C === 1 && pl4.A === 2 && pl4.D === 3 && pl4.B === 4, "最終順位 1〜4位");
const duoMap = { scrim: { games: { g1: g(1, "A", "B", "A"), g2: g(2, "A", "B", "A") } },
  main: { games: { g1: g(1, "A", "B", "B"), g2: g(2, "A", "B", "B"), g3: g(3, "A", "B", "B") } } };
const pl2 = finalPlacements("duo", resolveBracket(duo.series, duoMap));
assert(pl2.B === 1 && pl2.A === 2, "duoはスクリムを無視し本番で順位");

// ---- フィアレス ----
const pk = (a, b) => ({ A: Object.fromEntries(R.map((r, i) => [r, a[i]])), B: Object.fromEntries(R.map((r, i) => [r, b[i]])) });
const fg = {
  g1: { ...g(1, "A", "B", "A", pk(["a1", "a2", "a3", "a4", "a5"], ["b1", "b2", "b3", "b4", "b5"])), bans: { A: ["x1"], B: ["x2"] } },
  g2: g(2, "B", "A", "B", pk(["c1", "c2", "c3", "c4", "c5"], ["d1", "d2", "d3", "d4", "d5"])),
};
assert(fearlessLocked(fg, 1).size === 0, "第1試合はロックなし");
const lock3 = fearlessLocked(fg, 3);
assert(lock3.size === 20 && lock3.has("a1") && lock3.has("d5"), "第3試合時点で20体ロック");
assert(!lock3.has("x1"), "BANはロックしない");
assert(fearlessConflicts(fg).length === 0, "競合なし");
const fgBad = { ...fg, g1: { ...fg.g1, picks: pk(["c1", "a2", "a3", "a4", "a5"], ["b1", "b2", "b3", "b4", "b5"]) } };
const conf = fearlessConflicts(fgBad);
assert(conf.length === 1 && conf[0].no === 2 && conf[0].champ === "c1", "過去試合の修正で後続試合の重複を検出");
assert(sideChooser(fg, 1) === null, "第1試合のサイドはダイス");
assert(sideChooser(fg, 2) === "B", "第2試合は前試合敗者");
assert(sideChooser(fg, 3) === "A", "第3試合も前試合敗者");

// ---- 補欠使用状況 ----
const tS = { ...mkTeam("A", [80, 80, 80, 80, 80], { subs: { S: sub } }) };
const smSub = { sf1: { games: { g1: { ...g(1, "A", "D", "A"), lineup: { A: { ...starterLineup(tS), MID: "S" } } } } } };
const resSub = resolveBracket(se.series, smSub);
assert(subRoleUsage(tS, resSub, smSub, 1).S === "MID", "同日の補欠出場ロール");
assert(!subRoleUsage(tS, resSub, smSub, 2).S, "別日はリセット");
assert(!subRoleUsage(tS, resSub, smSub, 1, { key: "sf1", no: 1 }).S, "編集中の試合は除外");

// ---- 成績 ----
const stA = mkTeam("A", [80, 80, 80, 80, 80]);
const stB = mkTeam("B", [80, 80, 80, 80, 80]);
const stMap = { scrim: { games: { g1: { ...g(1, "A", "B", "A", pk(["a1", "a2", "a3", "a4", "a5"], ["b1", "b2", "b3", "b4", "b5"])),
  lineup: { A: starterLineup(stA), B: starterLineup(stB) }, kda: { "A-TOP": { k: 5, d: 1, a: 3 } }, bans: { A: ["z"], B: [] } } } } };
const st = tournamentStats({ A: stA, B: stB }, resolveBracket(duo.series, stMap), stMap);
const topA = st.players.find((p) => p.playerId === "A-TOP");
assert(topA && topA.games === 1 && topA.wins === 1 && topA.k === 5 && topA.champs.a1 === 1, "選手成績");
assert(st.champs.find((c) => c.champ === "a1").wins === 1 && st.champs.find((c) => c.champ === "z").bans === 1, "チャンピオン成績");
assert(st.teams.find((x) => x.teamId === "A").gw === 1 && st.teams.find((x) => x.teamId === "B").gl === 1, "チーム成績");

// ---- 抽選 ----
let seed = 1; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const drawn = drawSeeds(["A", "B", "C", "D"], rng);
assert(drawn.length === 4 && new Set(drawn).size === 4, "drawSeeds: 全員含む");
assert(drawSurvivors(["A", "B", "C"], 2, rng).length === 2, "drawSurvivors: 指定数");


// ==== 2回目レビューで見つかった不具合の再現テスト ====

// ---- ルール値の正規化: 管理画面の数値入力をそのまま受けるため、範囲外・不正値を丸める ----
const nr = normalizeRules({ pointCap: "abc", maxMasterPlus: -1, maxSubs: 9.6, bestOf: { sf: 4, final: "5", third: 0 } });
assert(nr.pointCap === 430, "rules: 不正な上限は既定値");
assert(nr.maxMasterPlus === 0, "rules: M+上限は0未満にならない");
assert(nr.maxSubs === 5, "rules: 補欠上限は0〜5の整数");
assert(nr.bestOf.sf === 3 && nr.bestOf.final === 5 && nr.bestOf.third === 5, "rules: BOは1/3/5以外なら既定値、文字列は数値化");
assert(normalizeRules({ pointCap: "0" }).pointCap === 430, "rules: 上限0以下は既定値");
assert(normalizeRules({ pointCap: "420.5" }).pointCap === 420.5, "rules: 文字列の上限は数値化");

// ---- 勝者未記録の試合があるシリーズ: 次の試合へ進ませない ----
const pend = seriesState({ a: "A", b: "B", bestOf: 3 }, { g1: g(1, "A", "B", "A"), g2: g(2, "B", "A", null) });
assert(pend.pendingNo === 2, "seriesState: 勝者未記録の試合番号");
assert(pend.nextNo === null && !pend.done, "seriesState: 勝者未記録の間は次の試合を入力させない");
const noPend = seriesState({ a: "A", b: "B", bestOf: 3 }, { g1: g(1, "A", "B", "A") });
assert(noPend.pendingNo === null && noPend.nextNo === 2, "seriesState: 全試合に勝者があれば次へ");

// ---- 成績: 勝者未記録の試合を負けとして数えない ----
const pdMap = { scrim: { games: { g1: { ...g(1, "A", "B", null, pk(["a1", "a2", "a3", "a4", "a5"], ["b1", "b2", "b3", "b4", "b5"])),
  lineup: { A: starterLineup(stA), B: starterLineup(stB) } } } } };
const pdStats = tournamentStats({ A: stA, B: stB }, resolveBracket(duo.series, pdMap), pdMap);
const pdTop = pdStats.players.find((x) => x.playerId === "A-TOP");
assert(pdTop.games === 1 && pdTop.wins === 0 && pdTop.losses === 0, "成績: 勝者未記録の試合は勝ちにも負けにも数えない");
assert(pdStats.champs.find((c) => c.champ === "a1").losses === 0, "成績: チャンピオンも同様");
const decided = tournamentStats({ A: stA, B: stB }, resolveBracket(duo.series, stMap), stMap);
assert(decided.players.find((x) => x.playerId === "B-TOP").losses === 1, "成績: 負けは losses に数える");

// ---- 過去試合の編集: 後の試合で使ったチャンピオンも選べない ----
const blocked1 = fearlessBlocked(fg, 1);
assert(blocked1.has("c1") && blocked1.has("d5"), "編集: 第1試合を直す時、第2試合のピックは選べない");
assert(!blocked1.has("a1"), "編集: 自分の試合のピックは選べる");
assert(fearlessBlocked(fg, 3).size === 20, "新規: 第3試合では既存20体が選べない");

// ---- ドラフト取り消し時の記録特定: 番号ではなくピックの組で照合する ----
const drMap = {
  g1: { ...g(1, "A", "B", "A", pk(["a1", "a2", "a3", "a4", "a5"], ["b1", "b2", "b3", "b4", "b5"])), draftIdx: 0 },
  g2: { ...g(2, "B", "A", null, pk(["c1", "c2", "c3", "c4", "c5"], ["d1", "d2", "d3", "d4", "d5"])), draftIdx: 0 },
};
const found = findDraftRecord(drMap, ["c1", "c2", "c3", "c4", "c5", "d1", "d2", "d3", "d4", "d5"]);
assert(found && found.no === 2, "ドラフト記録: ドラフトをリセットして番号が重複してもピックの組で特定");
assert(!findDraftRecord(drMap, ["c1", "c2", "c3", "c4", "c5", "d1", "d2", "d3", "d4", "zz"]), "ドラフト記録: 記録側を編集済みなら消さない");
assert(!findDraftRecord({ g1: { ...drMap.g1, draftIdx: undefined } }, ["a1", "a2", "a3", "a4", "a5", "b1", "b2", "b3", "b4", "b5"]), "ドラフト記録: 手入力の記録は対象外");

// ---- BAN入力の分割: 英語名の空白で割らない ----
assert(JSON.stringify(splitChampList("Miss Fortune, Lee Sin、アーリ，Twisted Fate / Jax")) === JSON.stringify(["Miss Fortune", "Lee Sin", "アーリ", "Twisted Fate", "Jax"]), "BAN: 区切りは読点・カンマ・スラッシュのみ");
assert(splitChampList("  ").length === 0, "BAN: 空入力");


// ---- 登録締切: 受付中だけチームの追加・削除ができ、締切後に試合を始められる ----
const NOW = 1_800_000_000_000;
assert(isEntryOpen({ status: "entry" }, NOW), "締切: 何も設定していなければ受付中");
assert(!isEntryOpen({ status: "entry", entryClosed: true }, NOW), "締切: 手動で締め切ったら受付終了");
assert(!isEntryOpen({ status: "entry", entryDeadline: NOW - 1 }, NOW), "締切: 締切日時を過ぎたら受付終了");
assert(!isEntryOpen({ status: "entry", entryDeadline: NOW }, NOW), "締切: 締切日時ちょうども受付終了");
assert(isEntryOpen({ status: "entry", entryDeadline: NOW + 60000 }, NOW), "締切: 締切日時前は受付中");
assert(!isEntryOpen({ status: "running" }, NOW), "締切: 試合が始まった大会は受付終了");
assert(!isEntryOpen({ status: "finished" }, NOW), "締切: 終了した大会は受付終了");
assert(!isEntryOpen(null, NOW), "締切: 大会が無ければ受付しない");

console.log(failed === 0 ? "\nすべて成功" : `\n${failed}件失敗`);
process.exit(failed === 0 ? 0 : 1);
