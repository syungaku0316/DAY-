// レート計算(純関数)。CustomStats.jsx から切り出したもの。React / Firebase / i18n に依存しない。
// 単体テスト: node src/rating.test.mjs

/* 30〜150のランクポイントスケール(ユーザー運用値)を採用。
   旧スケール(1ティア=2pt)の約4倍幅のため、σ/β/補正も×4して挙動を維持 */
const MU0 = 60; // フォールバック既定値(旧データ移行用)
const SIGMA_RATED = 20;
const SIGMA_UNRANKED = 24;
const SIGMA_FLOOR = 8; // σ下限。長期でも1勝±0.6pt程度は動く
const BETA = 50 / 3;
const TAU = 0.6;
// 基準変動幅: 互角の対面での1勝=約+2pt(LoLの5連勝≒3ディビジョン相当を目安に調整)
const K_SCALE = 0.37;
// 連勝/連敗補正: 1試合ごとに±10%、勝ちは最大+50%増、負けは最大50%まで軽減
const STREAK_STEP = 0.1;
const STREAK_MAX_MULT = 1.5;
const STREAK_MIN_MULT = 0.5;
// レート帯の下限・上限
const RATING_FLOOR = 20;
const RATING_CEIL = 160;
const clampRating = (v) => Math.max(RATING_FLOOR, Math.min(RATING_CEIL, v));

const ROLES = ["TOP", "JG", "MID", "ADC", "SUP"];

const RANKS = [
  ["チャレンジャー", 150], ["グランドマスター", 120], ["マスター", 100],
  ["D1", 98], ["D2", 94], ["D3", 90], ["D4", 86],
  ["E1", 82], ["E2", 79], ["E3", 76], ["E4", 73],
  ["P1", 70], ["P2", 66], ["P3", 64], ["P4", 62],
  ["G1", 60], ["G2", 56], ["G3", 54], ["G4", 52],
  ["S1", 48], ["S2", 46], ["S3", 44], ["S4", 42],
  ["B1", 40], ["B2", 39], ["B3", 38], ["B4", 37],
  ["I1", 36], ["I2", 34], ["I3", 32], ["I4", 30],
  ["アンランク", 30], ["初心者", 30],
];

// 習熟度補正: 比率方式(オフロール実力は本体実力に比例して低下)。σは不慣れなほど大きく。
const PROF_RATE = { "◎": 1.0, "〇": 0.92, "△": 0.85, "×": 0.75 };
const PROF_SIGMA_MULT = { "◎": 1.0, "〇": 1.0, "△": 1.1, "×": 1.2 };

// 名誉レート: 申告ランク(p.rank)は事実として保持したまま、レート計算の基準値だけを
// 実力相応のランク相当に差し替える仕組み。σ収束を待つには遅いと管理者が判断した場合に使う。
// 上方向のみ許可(申告ランクより低い指定は不可)。
function rankMu(rankLabel) {
  const found = RANKS.find(([label]) => label === rankLabel);
  return found ? found[1] : null;
}
// レート計算に実際に使う基準値。honorRankが設定されていればそちらを優先する。
function effectiveBaseMu(p) {
  const hm = p && p.honorRank ? rankMu(p.honorRank) : null;
  return hm != null ? hm : (p && p.baseMu != null ? p.baseMu : MU0);
}

function initRoles(profMap, baseMu, unranked) {
  const base = unranked ? SIGMA_UNRANKED : SIGMA_RATED;
  const roles = {};
  ROLES.forEach((r) => {
    const prof = profMap[r] || "△";
    roles[r] = {
      mu: Math.round(baseMu * PROF_RATE[prof] * 10) / 10,
      sigma: base * PROF_SIGMA_MULT[prof],
      prof, streak: 0,
    };
  });
  return roles;
}

// 対面(同ロール)のレート差を基準にした更新式。
// - 対面より弱い相手に負けてもほぼ変動しない/強い相手に勝つと大きく増える(期待値ベース)
// - 連勝は上げ幅を、連敗は下げ幅を最大50%まで補正
// - 同ロールの対面が組まれていない試合は相手チーム平均で代替
function computeLaneUpdate(entries, players, winner) {
  const findPlayer = (id) => players.find((x) => x.id === id);
  const results = {};

  entries.forEach((e) => {
    const p = findPlayer(e.playerId);
    if (!p) return;
    const self = p.roles[e.role];
    const selfSigma = Math.sqrt(self.sigma ** 2 + TAU ** 2);

    const oppTeam = e.team === "A" ? "B" : "A";
    const oppEntry = entries.find((x) => x.team === oppTeam && x.role === e.role);
    let oppMu, oppSigma;
    if (oppEntry) {
      const op = findPlayer(oppEntry.playerId);
      if (op) {
        oppMu = op.roles[oppEntry.role].mu;
        oppSigma = Math.sqrt(op.roles[oppEntry.role].sigma ** 2 + TAU ** 2);
      }
    }
    if (oppMu == null) {
      // 通常は発生しない(同ロール対面は必ず組まれる想定)。保険として互角扱いにする。
      oppMu = self.mu;
      oppSigma = SIGMA_RATED;
    }

    const c = Math.sqrt(selfSigma ** 2 + oppSigma ** 2 + 2 * BETA * BETA);
    const E = 1 / (1 + Math.exp((oppMu - self.mu) / c));
    const S = e.team === winner ? 1 : 0;

    const prevStreak = self.streak || 0;
    let streakAfter, mult;
    if (S === 1) {
      streakAfter = prevStreak > 0 ? prevStreak + 1 : 1;
      mult = Math.min(STREAK_MAX_MULT, 1 + STREAK_STEP * (streakAfter - 1));
    } else {
      streakAfter = prevStreak < 0 ? prevStreak - 1 : -1;
      mult = Math.max(STREAK_MIN_MULT, 1 - STREAK_STEP * (Math.abs(streakAfter) - 1));
    }

    const omega = (selfSigma * selfSigma) / c;
    const delta = K_SCALE * omega * (S - E) * mult;
    const muAfter = clampRating(self.mu + delta);
    const shrink = Math.max(1 - 2.0 * (selfSigma ** 2) / (c * c), 0.15);
    const sigmaAfter = Math.max(selfSigma * Math.sqrt(shrink), SIGMA_FLOOR);

    results[p.id] = { muAfter, sigmaAfter, streakAfter, delta: muAfter - self.mu };
  });

  return { results };
}

// 試合1件をプレイヤー配列へ適用(純関数)
function applyMatchToPlayers(players, match) {
  const { results } = computeLaneUpdate(match.entries, players, match.winner);
  return players.map((p) => {
    const entry = match.entries.find((e) => e.playerId === p.id);
    if (!entry || !results[p.id]) return p;
    const r = results[p.id];
    const won = entry.team === match.winner;
    return {
      ...p,
      roles: { ...p.roles, [entry.role]: { ...p.roles[entry.role], mu: r.muAfter, sigma: r.sigmaAfter, streak: r.streakAfter } },
      wins: p.wins + (won ? 1 : 0), losses: p.losses + (won ? 0 : 1),
      kdaHistory: [...p.kdaHistory, {
        ...((match.kda || {})[p.id] || {}), matchId: match.id, ts: match.timestamp,
        role: entry.role, mu: r.muAfter, delta: r.delta,
        won, champion: entry.champion || "", side: entry.team,
      }].sort((a, b) => (a.ts || 0) - (b.ts || 0)),
    };
  });
}

// レートに反映する試合か。承認待ちは対象外(status の無い旧データは承認済み扱い)
const isRatedMatch = (m) => !!m && (m.status || "approved") === "approved";

// 全試合を初期値から再計算(試合削除時に使用)。
// 渡された試合のうち承認済みだけを適用する(呼び出し側の絞り込み漏れで承認待ちがレートに入るのを防ぐ)
function recomputeAll(players, matches) {
  let ps = players.map((p) => {
    const profMap = {};
    ROLES.forEach((r) => { profMap[r] = p.roles[r].prof; });
    const unranked = p.rank === "アンランク" || p.rank === "初心者" || !p.rank;
    return {
      ...p,
      roles: initRoles(profMap, effectiveBaseMu(p), unranked),
      wins: 0, losses: 0, kdaHistory: [],
    };
  });
  matches.filter(isRatedMatch).sort((a, b) => a.timestamp - b.timestamp).forEach((m) => {
    ps = applyMatchToPlayers(ps, m);
  });
  return ps;
}

// 試合の出場メンバー検証。レート計算は同ロールの対面どうしで行うため、5対5・各チームでロール重複なしが前提。
// (手入力で追加した選手はロールの既定値が全員MIDになり、直し忘れると対面がずれたまま計算される)
function validateMatchEntries(entries) {
  const errors = [];
  ["A", "B"].forEach((team) => {
    const es = entries.filter((e) => e.team === team);
    if (es.length !== 5) errors.push({ code: "teamSize", team, count: es.length });
    const seen = new Set();
    es.forEach((e) => {
      if (seen.has(e.role)) { if (!errors.some((x) => x.code === "dupRole" && x.team === team && x.role === e.role)) errors.push({ code: "dupRole", team, role: e.role }); }
      seen.add(e.role);
    });
  });
  const ids = new Set();
  entries.forEach((e) => {
    if (ids.has(e.playerId)) errors.push({ code: "dupPlayer", playerId: e.playerId });
    ids.add(e.playerId);
  });
  return errors;
}

// サーバー上の最新の選手配列に、指定した選手だけの変更を当てた新しい配列を返す(対象がいなければ null)。
// 手元の古い配列で全員分を上書きすると、同時に操作した他の人の変更が消えるため、トランザクション内でこれを使う
function patchPlayerById(list, id, fn) {
  const i = list.findIndex((p) => p && p.id === id);
  if (i < 0) return null;
  const next = [...list];
  next[i] = fn(list[i]);
  return next;
}

export {
  MU0, SIGMA_RATED, SIGMA_UNRANKED, SIGMA_FLOOR, BETA, TAU, K_SCALE, STREAK_STEP, STREAK_MAX_MULT, STREAK_MIN_MULT,
  RATING_FLOOR, RATING_CEIL, clampRating, ROLES, RANKS, PROF_RATE, PROF_SIGMA_MULT,
  rankMu, effectiveBaseMu, initRoles, computeLaneUpdate, applyMatchToPlayers, recomputeAll,
  isRatedMatch, validateMatchEntries, patchPlayerById,
};
