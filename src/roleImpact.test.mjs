// Node単体テスト（実行: node src/roleImpact.test.mjs）
import { matchLaneDiffs, roleImpact, rateWithMargin, pairMatrix, hasBigGap } from "./roleImpact.js";
import { ROLES } from "./rating.js";

let failed = 0;
function assert(cond, label) {
  if (!cond) { console.error(`FAIL: ${label}`); failed++; }
  else console.log(`ok: ${label}`);
}

// 試合を組み立てる: mus = { TOP: [ブルーμ, レッドμ], ... }。各選手の履歴に 試合後μ と変動量 を入れる(試合前 = 試合後 − 変動量)
let seq = 0;
function buildMatch(players, mus, winner, extra = {}) {
  const id = `m${++seq}`;
  const entries = [];
  ROLES.forEach((r) => ["A", "B"].forEach((team, i) => {
    const pid = `${id}-${r}-${team}`;
    const before = mus[r][i];
    const delta = team === winner ? 2 : -2;
    players.push({ id: pid, kdaHistory: [{ matchId: id, role: r, mu: before + delta, delta }] });
    entries.push({ playerId: pid, team, role: r });
  }));
  return { id, status: "approved", winner, timestamp: seq, entries, ...extra };
}
const even = (over = {}) => Object.fromEntries(ROLES.map((r) => [r, over[r] || [60, 60]]));

// ---- 試合前レートの復元 ----
{
  const players = [];
  const m = buildMatch(players, even({ JG: [80, 60], TOP: [55, 60] }), "A");
  const { rows, skipped } = matchLaneDiffs(players, [m]);
  assert(rows.length === 1 && skipped === 0, "1試合が集計対象になる");
  assert(rows[0].diffs.JG === 200, `JG差は試合前の +20.0pt(0.1pt単位で200)。実際 ${rows[0].diffs.JG}`);
  assert(rows[0].diffs.TOP === -50, "TOP差は -5.0pt(レッド有利)");
  assert(rows[0].total === 150, "合計差は +15.0pt");
}

// ---- 集計できない試合は除外して数える ----
{
  const players = [];
  const ok = buildMatch(players, even({ JG: [70, 60] }), "A");
  const pending = buildMatch(players, even({ JG: [70, 60] }), "A", { status: "pending" });
  const missing = buildMatch(players, even(), "B");
  const gone = missing.entries[0].playerId;
  const playersWithoutOne = players.filter((p) => p.id !== gone); // 選手削除で履歴が消えた
  const dup = buildMatch(players, even(), "A");
  dup.entries[1] = { ...dup.entries[1], role: "TOP", team: "A" }; // ブルーTOPが2人
  const { rows, skipped } = matchLaneDiffs([...playersWithoutOne, ...players.filter((p) => p.id.startsWith(dup.id))], [ok, pending, missing, dup]);
  assert(rows.length === 1 && rows[0].id === ok.id, "承認済みで完全な試合だけ残る");
  assert(skipped === 2, `履歴欠け・ロール重複の2試合を除外(承認待ちは数えない)。実際 ${skipped}`);
}

// ---- 上回った側の勝率・差の区分・他レーン劣勢 ----
{
  const players = [];
  const ms = [
    buildMatch(players, even({ JG: [80, 60], TOP: [50, 60], MID: [50, 60] }), "A"), // JG+20 で勝ち。他4レーン合計 -20 で劣勢
    buildMatch(players, even({ JG: [63, 60] }), "B"),                               // JG+3 で負け(小差)
    buildMatch(players, even({ JG: [60, 70] }), "B"),                               // JG -10(レッド有利)でレッド勝ち(中差)
    buildMatch(players, even(), "A"),                                               // 全レーン同点 → どのロールも対象外
  ];
  const { rows } = matchLaneDiffs(players, ms);
  const imp = roleImpact(rows);
  assert(imp.JG.all.n === 3 && imp.JG.all.wins === 2, `JGは同点を除く3試合で、上回った側が2勝。実際 ${imp.JG.all.wins}/${imp.JG.all.n}`);
  assert(imp.JG.bins.small.n === 1 && imp.JG.bins.small.wins === 0, "差5pt未満: 1試合0勝");
  assert(imp.JG.bins.mid.n === 1 && imp.JG.bins.mid.wins === 1, "差5〜15pt: 1試合1勝");
  assert(imp.JG.bins.large.n === 1 && imp.JG.bins.large.wins === 1, "差15pt以上: 1試合1勝(境界15は以上側)");
  assert(imp.JG.against.n === 1 && imp.JG.against.wins === 1, "JGだけ上回り他4レーン合計で劣勢の試合: 1試合1勝");
  assert(Math.abs(imp.JG.avgAbs - 11) < 1e-9, `JGの平均差は (20+3+10)/3 = 11pt。実際 ${imp.JG.avgAbs}`);
  assert(imp.SUP.all.n === 0, "差が無いロールは対象0試合");
  assert(imp.TOTAL.all.n === 2, `合計差が0の試合(1試合目は合計0)は対象外。実際 ${imp.TOTAL.all.n}`);
  assert(imp.TOTAL.against.n === 0, "チーム合計に『他レーン劣勢』は無い");
}

// ---- 他レーンの不利が集中か分散か / 組み合わせ表 / 絞り込み ----
{
  const players = [];
  const ms = [
    buildMatch(players, even({ JG: [75, 60], ADC: [40, 70] }), "B"),                                       // JG+15 / ADC-30(集中)でレッド勝ち
    buildMatch(players, even({ JG: [75, 60], TOP: [55, 60], MID: [55, 60], ADC: [55, 60], SUP: [55, 60] }), "A"), // JG+15 / 各-5(分散)でブルー勝ち
    buildMatch(players, even({ JG: [60, 72], ADC: [80, 60] }), "B"),                                        // レッドJG+12 / レッドADC-20(集中)、合計はブルー有利 → レッド勝ち
    buildMatch(players, even({ JG: [65, 60], ADC: [60, 70] }), "A"),                                        // JG+5 / ADC-10(15未満なので分散)
  ];
  const { rows } = matchLaneDiffs(players, ms);
  const imp = roleImpact(rows);
  assert(imp.JG.against.n === 4, `JG: 他4レーン合計で低い試合は4つ。実際 ${imp.JG.against.n}`);
  assert(imp.JG.againstConc.n === 2 && imp.JG.againstConc.wins === 1, `集中(他に15pt以上低いレーンあり): 2試合1勝。実際 ${imp.JG.againstConc.wins}/${imp.JG.againstConc.n}`);
  assert(imp.JG.againstSpread.n === 2 && imp.JG.againstSpread.wins === 2, `分散: 2試合2勝。実際 ${imp.JG.againstSpread.wins}/${imp.JG.againstSpread.n}`);
  assert(imp.JG.againstConc.n + imp.JG.againstSpread.n === imp.JG.against.n, "集中+分散 = 他4レーン劣勢の合計");

  const pm = pairMatrix(rows);
  assert(pm.JG.ADC.n === 2 && pm.JG.ADC.wins === 1, `JG高×ADC15pt以上低: 2試合1勝。実際 ${pm.JG.ADC.wins}/${pm.JG.ADC.n}`);
  // 逆側から見たマス: 1試合目(レッドADC+30・レッドJG-15、レッド勝ち)と2試合目(レッドADC+5・レッドJG-15、レッド負け)
  assert(pm.ADC.JG.n === 2 && pm.ADC.JG.wins === 1, `ADC高×JG15pt以上低 は2試合1勝。実際 ${pm.ADC.JG.wins}/${pm.ADC.JG.n}`);
  assert(pm.JG.JG === undefined, "同じロール同士のマスは無い");
  const pm10 = pairMatrix(rows, 10);
  assert(pm10.JG.ADC.n === 3 && pm10.JG.ADC.wins === 2, `基準10ptなら ADC-10 の試合も入り3試合2勝。実際 ${pm10.JG.ADC.wins}/${pm10.JG.ADC.n}`);

  assert(rows.filter((r) => hasBigGap(r)).length === 3, "15pt以上の差があるレーンを含む試合は3つ(JG+15の試合も含む)");
  assert(rows.filter((r) => hasBigGap(r, 20)).length === 2, "基準20ptなら2つ");
}

// ---- 目安幅 ----
{
  assert(rateWithMargin({ n: 0, wins: 0 }) === null, "0試合は null");
  const one = rateWithMargin({ n: 1, wins: 1 });
  assert(one.p === 1 && one.margin > 0.3, "1試合1勝でも幅は大きく出る(100%±0 にしない)");
  const many = rateWithMargin({ n: 400, wins: 240 });
  assert(Math.abs(many.p - 0.6) < 1e-9 && many.margin < 0.05, `400試合なら幅は±5%未満。実際 ${(many.margin * 100).toFixed(1)}%`);
}

console.log(failed ? `\n${failed} 件失敗` : "\nすべて成功");
process.exit(failed ? 1 : 0);
