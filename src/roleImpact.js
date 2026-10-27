// ロール分析: ロールごとに「対面のレート差と勝敗の関係」を集計する純粋関数。
// どのロールも1試合で必ず1勝1敗が入るため「ロール別勝率」は常に50%で意味がない。
// 代わりに各試合・各ロールの試合前レート差(ブルー−レッド)を復元し、上回った側が勝った割合を出す。
// 試合前レート = 選手の試合履歴(kdaHistory)の 試合後μ − 変動量。新たな記録は不要で、過去の承認済み試合すべてに遡って集計できる。
import { ROLES, isRatedMatch } from "./rating.js";
import { toTenths } from "./fearless.js";

// 差の大きさの区分(pt)。下限を含み上限を含まない
const DIFF_BINS = [
  { key: "small", min: 0, max: 5 },
  { key: "mid", min: 5, max: 15 },
  { key: "large", min: 15, max: Infinity },
];

// 「大きく離された」とみなす対面差(pt)。差の区分の最上段・格差警告の既定値と同じ
const BIG_GAP_PT = 15;

// 画面表示(小数第1位)と同じ精度で比べるため、0.1pt単位の整数(toTenths: 表示値準拠)で扱う
const favoredSide = (d) => (d > 0 ? "A" : d < 0 ? "B" : null);

// 試合ごとのレーン差を復元する。diffs[ロール] / total は ブルー−レッド の0.1pt単位整数。
// 選手削除で履歴が無い・10人揃っていない・ロール欠けや重複がある・勝者不明の試合は集計できないので skipped に数える
function matchLaneDiffs(players, matches) {
  const preMu = new Map(); // `${matchId}|${playerId}` -> 試合前μ
  (players || []).forEach((p) => (p.kdaHistory || []).forEach((h) => {
    if (h && h.matchId != null && typeof h.mu === "number") preMu.set(`${h.matchId}|${p.id}`, h.mu - (Number(h.delta) || 0));
  }));
  const rows = [];
  let skipped = 0;
  (matches || []).filter(isRatedMatch).forEach((m) => {
    const entries = m.entries || [];
    let ok = (m.winner === "A" || m.winner === "B") && entries.length === ROLES.length * 2;
    const lane = {};
    entries.forEach((e) => {
      if (!ok) return;
      const mu = preMu.get(`${m.id}|${e.playerId}`);
      if (mu == null || !ROLES.includes(e.role) || (e.team !== "A" && e.team !== "B")) { ok = false; return; }
      lane[e.role] = lane[e.role] || {};
      if (lane[e.role][e.team] != null) { ok = false; return; }
      lane[e.role][e.team] = toTenths(mu);
    });
    if (ok) ok = ROLES.every((r) => lane[r] && lane[r].A != null && lane[r].B != null);
    if (!ok) { skipped++; return; }
    const diffs = Object.fromEntries(ROLES.map((r) => [r, lane[r].A - lane[r].B]));
    rows.push({ id: m.id, ts: m.timestamp || 0, winner: m.winner, diffs, total: ROLES.reduce((s, r) => s + diffs[r], 0) });
  });
  rows.sort((a, b) => b.ts - a.ts);
  return { rows, skipped };
}

const tally = () => ({ n: 0, wins: 0 });
const addTo = (tl, won) => { tl.n++; if (won) tl.wins++; };

// ロール別(+チーム合計 "TOTAL")に、上回った側の勝敗を集計する。差0(同点)の試合はそのロールの対象外。
//   all: 全体 / bins: 差の大きさ別 / against: そのロールだけ上回り、残り4レーン合計では下回っていた試合
//   (= そのロールに強い人を寄せた編成が勝てているか) / avgAbs: 平均の差(pt)
//   against はさらに、他のどこかのレーンで BIG_GAP_PT 以上下回っていた試合(againstConc: 不利が1レーンに集中)と
//   それ以外(againstSpread: 不利が分散)に分ける
function roleImpact(rows) {
  const out = {};
  [...ROLES, "TOTAL"].forEach((key) => {
    const s = { all: tally(), bins: Object.fromEntries(DIFF_BINS.map((b) => [b.key, tally()])), against: tally(), againstConc: tally(), againstSpread: tally(), avgAbs: 0 };
    let absSum = 0;
    rows.forEach((row) => {
      const d = key === "TOTAL" ? row.total : row.diffs[key];
      const side = favoredSide(d);
      if (!side) return;
      const won = row.winner === side;
      addTo(s.all, won);
      absSum += Math.abs(d);
      const pt = Math.abs(d) / 10;
      addTo(s.bins[DIFF_BINS.find((b) => pt >= b.min && pt < b.max).key], won);
      if (key !== "TOTAL") {
        const restSide = favoredSide(row.total - d);
        if (restSide && restSide !== side) {
          addTo(s.against, won);
          const bigLoss = ROLES.some((o) => o !== key && favoredSide(row.diffs[o]) === restSide && Math.abs(row.diffs[o]) >= BIG_GAP_PT * 10);
          addTo(bigLoss ? s.againstConc : s.againstSpread, won);
        }
      }
    });
    s.avgAbs = s.all.n ? absSum / s.all.n / 10 : 0;
    out[key] = s;
  });
  return out;
}

// ロールの組み合わせ表: out[高かったロール][低かったロール] = 行のロールで対面より高く、列のロールで minGapPt 以上低かった試合での
// 行側チームの勝敗(例: out.JG.ADC = JGで高く、ADCで大きく離された試合のJG側の勝敗)。1試合が複数のマスに入ることがある
function pairMatrix(rows, minGapPt = BIG_GAP_PT) {
  const lim = minGapPt * 10;
  const out = Object.fromEntries(ROLES.map((r) => [r, Object.fromEntries(ROLES.filter((o) => o !== r).map((o) => [o, tally()]))]));
  rows.forEach((row) => ROLES.forEach((r) => {
    const side = favoredSide(row.diffs[r]);
    if (!side) return;
    const won = row.winner === side;
    ROLES.forEach((o) => {
      if (o === r) return;
      const d = row.diffs[o];
      if (favoredSide(d) && favoredSide(d) !== side && Math.abs(d) >= lim) addTo(out[r][o], won);
    });
  }));
  return out;
}

// どこかのレーンに minGapPt 以上の対面差がある試合か(試合一覧の絞り込み用)
const hasBigGap = (row, minGapPt = BIG_GAP_PT) => ROLES.some((r) => Math.abs(row.diffs[r]) >= minGapPt * 10);

// 勝率と95%の目安幅(Wilsonスコア区間の半幅)。少数試合で 100%±0 のような過信表示を避けるため正規近似は使わない
function rateWithMargin({ n, wins }) {
  if (!n) return null;
  const z = 1.96;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { p, margin: half, n };
}

export { DIFF_BINS, BIG_GAP_PT, matchLaneDiffs, roleImpact, pairMatrix, hasBigGap, rateWithMargin };
