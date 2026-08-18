import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { theme, WIN_BADGE_IMG, LOSE_BADGE_IMG, THEME_LIST, FONT_LIST, applyTheme } from "./theme.js";
import { fileToImage, analyzeKda, toThumbnailBase64 } from "./scoreboardOcr.js";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set as fbSet, remove as fbRemove, runTransaction } from "firebase/database";
import {
  Trophy, Swords, CheckCircle2, History, Users, UserPlus,
  Scale, Trash2, Loader2, X, UserRound, Pencil, Medal, ExternalLink, ListOrdered, Palette, Coins, RefreshCw
} from "lucide-react";
import { computeEfficiency, PERCENT_DISPLAY_KEYS } from "./itemEfficiency.js";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import { t, setLang, getLang, rankLabel, rankShortLang, initialLang, dateLocale } from "./i18n.js";
import { champLabel, champCanonical } from "./champNames.js";

/* ---------------------------------------------------------
   Rating engine — Bayesian skill rating (TrueSkill/OpenSkill
   inspired simplified model). Per-role mu/sigma.
--------------------------------------------------------- */
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

const CHAMPIONS = [
  "アーゴット","アーリ","アイバーン","アカリ","アクシャン","アジール","アッシュ","アニー","アニビア","アフェリオス",
  "アムム","アリスター","アンベッサ","イラオイ","イレリア","イブリン","ヴァイ","ヴァルス","ヴィエゴ","ヴィクター",
  "ヴェイン","ヴェックス","ヴェル=コズ","ウーコン","ウディア","エイトロックス","エコー","エズリアル","エリス","オラフ",
  "オリアナ","オレリオン・ソル","オーン","オーロラ","カ=ジックス","カーサス","カイ=サ","カシオペア","カタリナ","カミール",
  "カリスタ","カルマ","カサディン","ガリオ","ガレン","ガングプランク","キヤナ","キンドレッド","グウェン","クイン",
  "グラガス","グレイブス","クレッド","ク=サンテ","ケイトリン","ケイル","ケイン","ケネン","コーキ","コグ=マウ",
  "サイオン","サイラス","ザック","サミーラ","ザヤ","ザイラ","ジェイス","シェン","ジグス","ジャーヴァンⅣ",
  "ジャックス","ジャンナ","シャコ","シヴァーナ","シヴィア","シンジド","シン・ジャオ","ジン","ジンクス","ジリアン",
  "スウェイン","スカーナー","スモルダー","セジュアニ","セト","セナ","セラフィーン","ゼド","ゼラス","ゼリ",
  "ソナ","ソラカ","ゾーイ","タム・ケンチ","タリック","タリヤ","タロン","ダイアナ","ダリウス","ツイステッド・フェイト",
  "ティーモ","トゥイッチ","ドクター・ムンド","トランドル","トリスターナ","トリンダメア","ドレイヴン","ナー","ナサス","ナフィーリ",
  "ナミ","ニーコ","ニーラ","ニダリー","ヌヌ&ウィルンプ","ノーチラス","ノクターン","バード","ハイマーディンガー","パイク",
  "パンテオン","ヘカリム","フィオラ","フィズ","フィドルスティックス","フエイ","ブライアー","ブラウム","ブラッドミア","ブリッツクランク",
  "ベイガー","ベル=ヴェス","ポッピー","ボリベア","マオカイ","マスター・イー","マルザハール","マルファイト","ミス・フォーチュン","ミリオ",
  "メル","モルガナ","モルデカイザー","ヤスオ","ユーミ","ユナラ","ヨネ","ヨリック","ラームス","ライズ",
  "ラカン","ラックス","リー・シン","リヴェン","リサンドラ","リリア","ルシアン","ルブラン","ルル","レク=サイ",
  "レナータ・グラスク","レネクトン","レル","レオナ","レンガー","ワーウィック"
];
const APP_CONF = (typeof window !== "undefined" && window.APP_CONFIG) || {};
const ADMIN_PASS = APP_CONF.adminPass || "37564";

// ---- テーマ準拠ダイアログ基盤 -------------------------------------------
// window.alert/confirm/promptの置き換え。コンポーネントがマウント時に_dialogSetを登録し、
// モジュールスコープの関数からPromiseベースでモーダルを起動する。
let _dialogSet = null; // コンポーネントのsetDialog
function pushDialog(d) {
  return new Promise((resolve) => { _dialogSet({ ...d, resolve }); });
}
// メッセージ内の指定語(選手名・ロール名等)をアクセント色で強調
function highlightNames(msg, names = []) {
  let parts = [msg];
  names.filter(Boolean).forEach((nm, ni) => {
    parts = parts.flatMap((seg) => {
      if (typeof seg !== "string" || !seg.includes(nm)) return [seg];
      const out = [];
      seg.split(nm).forEach((piece, i, arr) => {
        out.push(piece);
        if (i < arr.length - 1) out.push(<b key={`hl_${ni}_${i}`} style={{ color: theme.accent, fontWeight: 700 }}>{nm}</b>);
      });
      return out;
    });
  });
  return parts;
}
function themedAlert(msg, names = [], opts = {}) {
  if (!_dialogSet) { window.alert(msg); return Promise.resolve(); }
  return pushDialog({ type: "alert", content: highlightNames(msg, names), nowrap: !!opts.nowrap });
}
function themedConfirm(msg, names = []) {
  if (!_dialogSet) return Promise.resolve(window.confirm(msg));
  return pushDialog({ type: "confirm", content: highlightNames(msg, names) });
}
function themedPrompt(msg, { password = false, defaultValue = "" } = {}) {
  if (!_dialogSet) return Promise.resolve(window.prompt(msg, defaultValue));
  return pushDialog({ type: "prompt", content: highlightNames(msg), password, defaultValue });
}

// 管理者PASSをテーマモーダルで都度要求する共通ヘルパー。
// 一度正しく入力されたPASSはモジュールスコープにキャッシュし、以後の操作では再要求しない
// (連続操作の負担軽減。localStorage等の永続化はしないためリロードで消える)。
let adminPassCache = null;
async function requireAdminPass(label) {
  if (adminPassCache === ADMIN_PASS) return true;
  const v = await themedPrompt(`${label}\n${t("common.001")}`, { password: true });
  if (v === null) return false;
  if (v !== ADMIN_PASS) { await themedAlert(t("common.002")); return false; }
  adminPassCache = v;
  return true;
}
const VIEW_PASS = APP_CONF.viewPass || "";
// League Classic(2026/07/29, パッチ26.15〜)のチャンピオンはDDragonに別エントリとして
// 追加されており、id が "Jade_" 接頭辞・key が 60000+元key で、表示名は通常版と完全に同一。
// 記録は表示名(日本語)を正準値として保存しているため、そのまま取り込むと入力候補が二重化し、
// champImgMap も後勝ちでアイコンが上書きされてしまう。通常版のみを採用する。
const CLASSIC_ID_PREFIX = "Jade_";
const CLASSIC_KEY_BASE = 60000;
const isClassicChamp = (ch) =>
  String(ch.id || "").startsWith(CLASSIC_ID_PREFIX) || Number(ch.key) >= CLASSIC_KEY_BASE;

const ROLES = ["TOP", "JG", "MID", "ADC", "SUP"];

// 対面(同ロール)のμ差がこの値以上なら「格差マッチアップ」として警告する(pt)。
// 編成はブロックせず注意喚起のみ。管理者が設定画面から変更でき、全端末で共有される。
const MATCHUP_WARN_DEFAULT = 15;
const MATCHUP_WARN_MIN = 5;
const MATCHUP_WARN_MAX = 60;
const clampMatchupWarn = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return MATCHUP_WARN_DEFAULT;
  return Math.min(MATCHUP_WARN_MAX, Math.max(MATCHUP_WARN_MIN, Math.round(n * 10) / 10));
};

// 対面(同ロール)のレート差がしきい値以上のマッチアップを列挙する。
// μは編成時スナップショット(slot.mu)ではなく現在の選手データを優先する。
// 編成後に承認等でレートが動いた場合、対面比較タブの表示(statFor)とズレるのを防ぐため
// (liveWanted / liveNg と同じ「表示はライブ計算」方針に揃える)。
function matchupGaps(balanceResult, players, threshold) {
  if (!balanceResult || !balanceResult.teamA || !balanceResult.teamB) return [];
  const th = clampMatchupWarn(threshold);
  const muOf = (slot) => {
    const p = players.find((x) => x.id === slot.id);
    const live = p?.roles?.[slot.role]?.mu;
    return typeof live === "number" ? live : slot.mu;
  };
  const out = [];
  ROLES.forEach((role) => {
    const a = balanceResult.teamA.find((x) => x.role === role);
    const b = balanceResult.teamB.find((x) => x.role === role);
    if (!a || !b) return; // 片側欠員のレーンは判定しない
    const muA = muOf(a), muB = muOf(b);
    if (muA !== muA || muB !== muB) return; // NaNガード(既存 laneDiff と同方針)
    const diff = Math.abs(muA - muB);
    if (diff < th) return;
    out.push({
      role, diff,
      aId: a.id, bId: b.id, aName: a.name, bName: b.name, muA, muB,
      hiName: muA >= muB ? a.name : b.name,
      loName: muA >= muB ? b.name : a.name,
      hiMu: Math.max(muA, muB), loMu: Math.min(muA, muB),
      favor: muA > muB ? "A" : "B",
    });
  });
  return out; // ROLES順(TOP→SUP)
}

// ---- アイテム効率タブ: 統合statsキー→表示名i18nキー ----
const ITEM_STAT_LABEL_KEY = {
  FlatPhysicalDamageMod: "items.021", FlatMagicDamageMod: "items.022",
  FlatArmorMod: "items.023", FlatSpellBlockMod: "items.024",
  FlatHPPoolMod: "items.025", FlatMPPoolMod: "items.026",
  PercentAttackSpeedMod: "items.027", FlatCritChanceMod: "items.028",
  FlatMovementSpeedMod: "items.029", PercentMovementSpeedMod: "items.043",
  PercentLifeStealMod: "items.030", abilityHaste: "items.031",
  lethality: "items.032", magicPen: "items.033", percentMagicPen: "items.040",
  percentArmorPen: "items.034", tenacity: "items.035", omnivamp: "items.036",
  healShieldPower: "items.037", FlatHPRegenMod: "items.038", FlatMPRegenMod: "items.039",
};
// ---- 能力値名フィルタ(同一表示名のキーはグループ化: 移動速度の実数/%等) ----
const ITEM_STAT_FILTER_GROUPS = [
  { labelKey: "items.021", keys: ["FlatPhysicalDamageMod"] },
  { labelKey: "items.022", keys: ["FlatMagicDamageMod"] },
  { labelKey: "items.023", keys: ["FlatArmorMod"] },
  { labelKey: "items.024", keys: ["FlatSpellBlockMod"] },
  { labelKey: "items.025", keys: ["FlatHPPoolMod"] },
  { labelKey: "items.026", keys: ["FlatMPPoolMod"] },
  { labelKey: "items.027", keys: ["PercentAttackSpeedMod"] },
  { labelKey: "items.028", keys: ["FlatCritChanceMod"] },
  { labelKey: "items.029", keys: ["FlatMovementSpeedMod"] },
  { labelKey: "items.043", keys: ["PercentMovementSpeedMod"] },
  { labelKey: "items.030", keys: ["PercentLifeStealMod"] },
  { labelKey: "items.031", keys: ["abilityHaste"] },
  { labelKey: "items.032", keys: ["lethality"] },
  { labelKey: "items.033", keys: ["magicPen"] },
  { labelKey: "items.040", keys: ["percentMagicPen"] },
  { labelKey: "items.034", keys: ["percentArmorPen"] },
  { labelKey: "items.035", keys: ["tenacity"] },
  { labelKey: "items.037", keys: ["healShieldPower"] },
  { labelKey: "items.036", keys: ["omnivamp"] },
  { labelKey: "items.038", keys: ["FlatHPRegenMod"] },
  { labelKey: "items.039", keys: ["FlatMPRegenMod"] },
];
const ITEM_TIERS = [
  { key: "ALL", labelKey: "items.004" }, { key: "base", labelKey: "items.005" },
  { key: "epic", labelKey: "items.006" }, { key: "legendary", labelKey: "items.007" },
];
// status: active/rest(2値) + adjust: boolean(調整枠、休みと併存可)
const statusRank = (p) => (p.status === "rest" ? 2 : p.adjust ? 1 : 0);
// チームA=ブルーサイド / チームB=レッドサイド
const sideLabel = (side) => (side === "A" ? t("report.011") : t("report.012"));
const PROFS = ["◎", "〇", "△", "×"];
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
// 選手カード表示用の短縮表記(登録プルダウンの選択肢名はそのまま)
const RANK_SHORT = { "マスター": "M", "グランドマスター": "GM", "チャレンジャー": "C", "アンランク": "U", "初心者": "初" };
const rankShort = (rank) => RANK_SHORT[rank] || rank;
// 習熟度補正: 比率方式(オフロール実力は本体実力に比例して低下)。σは不慣れなほど大きく。
const PROF_RATE = { "◎": 1.0, "〇": 0.92, "△": 0.85, "×": 0.75 };
const PROF_SIGMA_MULT = { "◎": 1.0, "〇": 1.0, "△": 1.1, "×": 1.2 };

// 実効習熟: 現在μ÷ランク基準値から実績ベースの習熟を逆算(表示専用、レート非干渉)
function effectiveProf(mu, baseMu) {
  const ratio = mu / Math.max(baseMu, 1);
  if (ratio >= 0.96) return "◎";
  if (ratio >= 0.885) return "〇";
  if (ratio >= 0.80) return "△";
  return "×";
}

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

// 旧データ(単一mu/sigma)を移行
function migratePlayer(p) {
  const kdaHistory = p.kdaHistory || [];
  const rawStatus = p.status || (p.inactive ? "rest" : "active");
  const status = rawStatus === "adjust" ? "active" : rawStatus; // active/rest の2値
  const adjust = status === "rest" ? false : (rawStatus === "adjust" || !!p.adjust);
  const prefRoles = p.prefRoles || [];
  const ngRoles = p.ngRoles || [];
  // 出欠ボード用: 自己申告の参加可能時間・ひとことメモ・最終応答時刻(未設定=未回答扱い)
  const availFrom = p.availFrom || "";
  const availTo = p.availTo || "";
  const memo = p.memo || "";
  const respondedAt = p.respondedAt || null;
  if (p.roles) {
    const roles = {};
    ROLES.forEach((r) => { roles[r] = { streak: 0, ...p.roles[r] }; });
    return { ...p, roles, kdaHistory, status, adjust, prefRoles, ngRoles, availFrom, availTo, memo, respondedAt };
  }
  const roles = {};
  ROLES.forEach((r) => {
    roles[r] = { mu: p.mu ?? MU0, sigma: p.sigma ?? SIGMA_RATED, prof: "〇", streak: 0 };
  });
  return { ...p, roles, kdaHistory, status, adjust, prefRoles, ngRoles, availFrom, availTo, memo, respondedAt };
}

// 順位基準: 保守的推定値 = μ − σ (信頼度込みの下限見積り)
// サモナー名#タグ からOP.GG(JPサーバー)のリンクを生成。タグが無い場合はnull。
function opggUrl(summonerName) {
  if (!summonerName || !summonerName.includes("#")) return null;
  const [name, tag] = summonerName.split("#");
  if (!name.trim() || !tag.trim()) return null;
  return `https://www.op.gg/summoners/jp/${encodeURIComponent(name.trim())}-${encodeURIComponent(tag.trim())}`;
}

function conservative(mu, sigma) {
  return mu - sigma;
}

// 代表レート = ◎ロール(複数なら最高μ)。◎が無ければ全ロール最高μ。
function mainRoleOf(p) {
  const best = ROLES.filter((r) => p.roles[r].prof === "◎");
  const pool = best.length ? best : ROLES;
  return pool.reduce((a, b) => (p.roles[a].mu >= p.roles[b].mu ? a : b));
}
function repRating(p) {
  const r = mainRoleOf(p);
  return p.roles[r];
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

// 選手1人分のプロフィール集計(参加/勝率/KDA/サイド別勝率/直近の調子/相性のいい味方・苦手な相手)。
// 「記録」タブの選手詳細パネルと「個人成績」タブで共通利用する(重複実装による乖離を避けるため)。
// roleFilter: "ALL" または ROLES の値。指定時は該当ロールの試合のみで再集計する。
function computePlayerProfile(p, roleFilter, players, matches, approvedMatches) {
  const roleFiltered = (h) => roleFilter === "ALL" || h.role === roleFilter;
  const sideOf = (h) => h.side || (() => {
    const m = matches.find((x) => x.id === h.matchId);
    return m?.entries.find((e) => e.playerId === p.id)?.team;
  })();
  const hist = [...p.kdaHistory].filter(roleFiltered).sort((a, b) => a.ts - b.ts)
    .map((h) => ({ ...h, side: sideOf(h) }));
  const wins = roleFilter === "ALL" ? p.wins : hist.filter((x) => x.won).length;
  const losses = roleFilter === "ALL" ? p.losses : hist.filter((x) => x.won === false).length;
  const games = wins + losses;
  const kdaHist = hist.filter((x) => x.k != null || x.d != null || x.a != null);
  const sum = (f) => kdaHist.reduce((s, x) => s + (x[f] || 0), 0);
  const avgK = kdaHist.length ? sum("k") / kdaHist.length : 0;
  const avgD = kdaHist.length ? sum("d") / kdaHist.length : 0;
  const avgA = kdaHist.length ? sum("a") / kdaHist.length : 0;
  const kdaRatio = kdaHist.length ? (sum("k") + sum("a")) / Math.max(sum("d"), 1) : 0;
  const wr = games ? wins / games : 0;

  // ロール内訳(選手の全体的な出場傾向。roleFilterに関係なく表示するため常に全履歴から集計)
  const roleCounts = {};
  p.kdaHistory.forEach((h) => { roleCounts[h.role] = (roleCounts[h.role] || 0) + 1; });
  const roleBadges = Object.entries(roleCounts).sort((x, y) => y[1] - x[1]).slice(0, 4);

  // サイド別勝率
  const sideStat = { A: { g: 0, w: 0 }, B: { g: 0, w: 0 } };
  hist.forEach((h) => {
    if (!sideStat[h.side]) return;
    sideStat[h.side].g++; if (h.won) sideStat[h.side].w++;
  });

  // 直近10試合(新しい順)と連勝/連敗
  const recent = [...hist].slice(-10).reverse();
  const recentWins = recent.filter((h) => h.won).length;
  let streak = 0, streakWon = null;
  for (const h of recent) {
    if (streakWon === null) { streakWon = h.won; streak = 1; }
    else if (h.won === streakWon) streak++;
    else break;
  }

  // 相性のいい味方・苦手な相手: 同じ試合で味方/敵になった際のこの選手視点の勝率(3戦以上)
  const synergy = {}, counter = {};
  approvedMatches.forEach((m) => {
    const mine = m.entries.find((e) => e.playerId === p.id && roleFiltered({ role: e.role }));
    if (!mine) return;
    const won = m.winner === mine.team;
    m.entries.forEach((e) => {
      if (e.playerId === p.id) return;
      const p2 = players.find((pp) => pp.id === e.playerId);
      if (!p2) return;
      const bucket = e.team === mine.team ? synergy : counter;
      if (!bucket[e.playerId]) bucket[e.playerId] = { name: p2.name, games: 0, wins: 0 };
      bucket[e.playerId].games++;
      if (won) bucket[e.playerId].wins++;
    });
  });
  const rankPairs = (obj, dir) => Object.values(obj)
    .filter((x) => x.games >= 3)
    .map((x) => ({ ...x, wr: x.wins / x.games }))
    .sort((x, y) => (dir === "desc" ? y.wr - x.wr : x.wr - y.wr) || y.games - x.games)
    .slice(0, 3);

  return {
    p, games, wins, losses, wr, kdaGames: kdaHist.length,
    avgK, avgD, avgA, kdaRatio,
    roleBadges, sideStat, history: hist, recent, recentWins, streak, streakWon,
    synergyList: rankPairs(synergy, "desc"),
    counterList: rankPairs(counter, "asc"),
  };
}

// 未回答判定: 3日以上respondedAtが更新されていない(または一度も応答していない)場合。
// 「出欠管理」タブと「選手一覧」タブの未回答フィルタで共用する。
const RESPONSE_STALE_MS = 3 * 24 * 60 * 60 * 1000;
const isStaleResponse = (p) => !p.respondedAt || (Date.now() - p.respondedAt > RESPONSE_STALE_MS);

// 相性のいい味方・苦手な相手の1行分の表示({name, games, wr}を受け取る)。「記録」「個人成績」両タブで共用。
function pairRow(x, color) {
  return (
    <div key={x.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 13, marginBottom: 6 }}>
      <span style={{ fontWeight: 700 }}>{x.name}</span>
      <span>
        <span style={{ color: theme.textFaint, marginRight: 6 }}>{x.games}{t("scoutMulti.006")}</span>
        <b style={{ color, fontSize: 15 }}>{Math.round(x.wr * 100)}%</b>
      </span>
    </div>
  );
}

// 全選手ぶんの参加/勝率/平均KDAの軽量集計(順位表用)。roleFilter指定時はそのロールのみで再集計する。
// computePlayerProfileと違い相性/苦手や直近試合までは集計しない(全選手分を回すため軽量さを優先)。
function computePlayerAggList(players, roleFilter) {
  const roleFiltered = (h) => roleFilter === "ALL" || h.role === roleFilter;
  return players.map((p) => {
    const h = p.kdaHistory.filter((x) => (x.k != null || x.d != null || x.a != null) && roleFiltered(x));
    const roleWins = roleFilter === "ALL" ? p.wins : h.filter((x) => x.won).length;
    const roleLosses = roleFilter === "ALL" ? p.losses : h.filter((x) => x.won === false).length;
    const total = roleWins + roleLosses;
    const sum = (f) => h.reduce((s, x) => s + (x[f] || 0), 0);
    return {
      id: p.id, name: p.name, games: total, kdaGames: h.length,
      totalK: sum("k"), totalA: sum("a"), totalD: sum("d"),
      avgK: h.length ? sum("k") / h.length : 0,
      avgD: h.length ? sum("d") / h.length : 0,
      avgA: h.length ? sum("a") / h.length : 0,
      wr: total ? roleWins / total : 0,
      kdaRatio: h.length ? (sum("k") + sum("a")) / Math.max(sum("d"), 1) : 0,
    };
  });
}

// スコア一覧の比較対象平均: aggList(computePlayerAggListの返り値)から本人を除き3戦以上の他選手で平均する。
function computeCmpAvg(aggList, excludeId) {
  const pool = aggList.filter((a) => a.id !== excludeId);
  const poolKda = pool.filter((a) => a.kdaGames >= 3);
  const poolWr = pool.filter((a) => a.games >= 3);
  const meanOf = (arr, f) => (arr.length ? arr.reduce((s, a) => s + a[f], 0) / arr.length : null);
  return {
    avgK: meanOf(poolKda, "avgK"), avgA: meanOf(poolKda, "avgA"), avgD: meanOf(poolKda, "avgD"),
    kdaRatio: meanOf(poolKda, "kdaRatio"), wr: meanOf(poolWr, "wr"),
  };
}

// スコア一覧の1行分(バー+他選手平均マーカー)。「記録」「個人成績」両タブで共用。
function scoreBar(label, value, pct, color, cmpVal, cmpPct, cmpFmt) {
  return (
    <div key={label} style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span style={{ color: theme.textSub }}>{label}</span>
        <span>
          <span style={{ fontWeight: 700 }}>{value}</span>
          {cmpVal != null && (
            <span style={{ fontSize: 12, color: theme.textFaint, marginLeft: 6 }}>{t("records.035", { v: cmpFmt(cmpVal) })}</span>
          )}
        </span>
      </div>
      <div style={{ position: "relative", height: 6, borderRadius: 3, background: theme.borderTable, marginTop: 3 }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 3, overflow: "hidden" }}>
          <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: "100%", background: color }} />
        </div>
        {cmpVal != null && (
          <div title={t("records.035", { v: cmpFmt(cmpVal) })}
            style={{ position: "absolute", left: `${Math.max(0, Math.min(100, cmpPct))}%`, top: -2, bottom: -2, width: 2, background: theme.text, opacity: 0.55 }} />
        )}
      </div>
    </div>
  );
}
// 5指標分のscoreBarをまとめて描画({avgK,avgA,avgD,kdaRatio,wr}を持つprofileと、同形のcmpAvgを受け取る)
function scoreBarRows(profile, cmpAvg) {
  return (
    <>
      {scoreBar(t("records.011"), profile.avgK.toFixed(1), (profile.avgK / 15) * 100, theme.accentBright,
        cmpAvg.avgK, cmpAvg.avgK != null ? (cmpAvg.avgK / 15) * 100 : null, (v) => v.toFixed(1))}
      {scoreBar(t("records.013"), profile.avgA.toFixed(1), (profile.avgA / 15) * 100, theme.accentBright,
        cmpAvg.avgA, cmpAvg.avgA != null ? (cmpAvg.avgA / 15) * 100 : null, (v) => v.toFixed(1))}
      {scoreBar(t("records.014"), profile.avgD.toFixed(1), (profile.avgD / 10) * 100, theme.teamB,
        cmpAvg.avgD, cmpAvg.avgD != null ? (cmpAvg.avgD / 10) * 100 : null, (v) => v.toFixed(1))}
      {scoreBar(t("records.015"), profile.kdaRatio.toFixed(2), (profile.kdaRatio / 6) * 100, theme.accentBright,
        cmpAvg.kdaRatio, cmpAvg.kdaRatio != null ? (cmpAvg.kdaRatio / 6) * 100 : null, (v) => v.toFixed(2))}
      {scoreBar(t("board.006"), `${Math.round(profile.wr * 100)}%`, profile.wr * 100, theme.accentBright,
        cmpAvg.wr, cmpAvg.wr != null ? cmpAvg.wr * 100 : null, (v) => `${Math.round(v * 100)}%`)}
    </>
  );
}

// 勝率予測: computeLaneUpdate内のE計算式と完全に同一の式(新しい式は作らない)。
// レート更新に使われている「期待勝率」そのものを、対面カード表示用に再利用する。
function winProb(muA, sigmaA, muB, sigmaB) {
  const sA = Math.sqrt(sigmaA ** 2 + TAU ** 2);
  const sB = Math.sqrt(sigmaB ** 2 + TAU ** 2);
  const c = Math.sqrt(sA * sA + sB * sB + 2 * BETA * BETA);
  return 1 / (1 + Math.exp((muB - muA) / c));
}

// チーム合算版の勝率予測(①と同じ式をチームレベルに拡張)。
// V = ΣσA²(TAU込み) + ΣσB²(TAU込み) + 10·BETA²(5人×2チーム分のBETA項)
function teamWinProb(teamAPlayers, teamBPlayers) {
  const adjSigma2 = (arr) => arr.reduce((s, x) => s + (x.sigma ** 2 + TAU ** 2), 0);
  const MA = teamAPlayers.reduce((s, x) => s + x.mu, 0);
  const MB = teamBPlayers.reduce((s, x) => s + x.mu, 0);
  const V = adjSigma2(teamAPlayers) + adjSigma2(teamBPlayers) + 10 * BETA * BETA;
  return 1 / (1 + Math.exp((MB - MA) / Math.sqrt(V)));
}

function combinations(arr, k) {
  const res = [];
  const rec = (start, combo) => {
    if (combo.length === k) { res.push([...combo]); return; }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]); rec(i + 1, combo); combo.pop();
    }
  };
  rec(0, []);
  return res;
}

function permutations(arr, k) {
  const res = [];
  const rec = (perm, used) => {
    if (perm.length === k) { res.push([...perm]); return; }
    for (let i = 0; i < arr.length; i++) {
      if (used.has(i)) continue;
      used.add(i); perm.push(arr[i]);
      rec(perm, used);
      perm.pop(); used.delete(i);
    }
  };
  rec([], new Set());
  return res;
}

// チーム分け最適化:
// 1. 両チーム合計レート差の最小化(最優先)
// 2. 同ロール対面のレート差合計の最小化
// 3. 得意ロール配置度(合計μ)の最大化
// を score = teamDiff + 0.5*laneDiff - 0.05*total で統合し全探索
const ROLE_ORDER = { TOP: 0, JG: 1, MID: 2, ADC: 3, SUP: 4 };

function validPerms(team) {
  const k = team.length;
  const perms = permutations(ROLES, k);
  return perms.filter((perm) =>
    team.every((p, i) => (!p.lockedRole || p.lockedRole === perm[i]) && !(p.ngRoles && p.ngRoles.includes(perm[i])))
  );
}

// 参加回数(+状態)が同数のグループ内でのみ、希望ロールのカバレッジを優先して必要人数を選出する。
// (1試合目など全員が同数の場合、キュー順=登録順で機械的に切ると意味がないため、
//  同数タイの範囲でのみチーム構成の質(希望ロールの充足)を優先する。参加回数自体の優先順位は変えない)
function pickByRoleCoverage(tier, need, alreadySelected) {
  const coverage = {};
  ROLES.forEach((r) => { coverage[r] = 0; });
  alreadySelected.forEach((p) => (p.prefRoles || []).forEach((r) => { coverage[r] = (coverage[r] || 0) + 1; }));
  const remaining = [...tier];
  const picked = [];
  for (let k = 0; k < need && remaining.length; k++) {
    let bestIdx = 0, bestScore = Infinity;
    remaining.forEach((p, idx) => {
      // 希望ロールがあればその中で最もカバレッジが低いロールのスコアを採用(埋まっていない希望ロールを優先)
      // 希望ロールなし(フレキシブル)はNGロールを除いた全ロールを対象に評価(汎用性の高さを活かして穴埋めに使う)
      const flexRoles = ROLES.filter((r) => !(p.ngRoles || []).includes(r));
      const prefs = (p.prefRoles && p.prefRoles.length ? p.prefRoles : flexRoles.length ? flexRoles : ROLES);
      const score = Math.min(...prefs.map((r) => coverage[r] ?? 0));
      const cur = remaining[bestIdx];
      // 同点タイブレークはレートの低い人を優先(先に確定枠を確保させる)。
      // レートの高い人を先に処理すると、後回しになった低レート層の選択肢が
      // 相対的に狭まりやすく、ゲーム体験への影響が大きいため。
      if (score < bestScore || (score === bestScore && (p.baseMu ?? 0) < (cur.baseMu ?? 0))) {
        bestScore = score; bestIdx = idx;
      }
    });
    const chosen = remaining.splice(bestIdx, 1)[0];
    (chosen.prefRoles && chosen.prefRoles.length ? chosen.prefRoles : ROLES).forEach((r) => { coverage[r] = (coverage[r] || 0) + 1; });
    picked.push(chosen);
  }
  return picked;
}

// pool から need 人を選出する。状態(アクティブ/調整枠/休み)→参加回数の順にtier分けし、
// tierを人数の少ない順に丸ごと採用。定員に収まらない境界tier(=同数タイ)だけ pickByRoleCoverage で選ぶ。
// baseline: 既に確定済みの選手(手動固定枠など)。役割カバレッジの計算に含めるが選出結果には含めない。
function pickSeatsFairly(pool, need, todayCounts, baseline = []) {
  const tierKey = (p) => `${statusRank(p)}_${todayCounts[p.id] || 0}`;
  const sorted = [...pool].sort((a, b) =>
    statusRank(a) - statusRank(b) || (todayCounts[a.id] || 0) - (todayCounts[b.id] || 0));
  const selected = [];
  let i = 0;
  while (i < sorted.length && selected.length < need) {
    const key = tierKey(sorted[i]);
    let j = i;
    while (j < sorted.length && tierKey(sorted[j]) === key) j++;
    const tier = sorted.slice(i, j);
    const remain = need - selected.length;
    if (tier.length <= remain) {
      selected.push(...tier);
    } else {
      selected.push(...pickByRoleCoverage(tier, remain, [...baseline, ...selected]));
    }
    i = j;
  }
  return selected;
}

function bestBalancedSplit(players) {
  const n = players.length;
  if (n < 2 || n > 10) return null;
  const half = Math.floor(n / 2);
  let best = null;
  const idx = players.map((_, i) => i);

  // チームごとの割当候補を事前計算(sum/lane/prefHits)し、A×B結合を軽量化
  const evalTeam = (team) => {
    const perms = validPerms(team);
    const out = [];
    for (const perm of perms) {
      let sum = 0, hits = 0, ngHits = 0;
      const lane = [NaN, NaN, NaN, NaN, NaN];
      for (let i = 0; i < team.length; i++) {
        const p = team[i];
        const role = perm[i];
        const m = p.roles[role].mu;
        sum += m;
        lane[ROLE_ORDER[role]] = m;
        if (p.prefRoles && p.prefRoles.length && p.prefRoles.includes(role)) hits++;
        if (p.ngRoles && p.ngRoles.length && p.ngRoles.includes(role)) ngHits++;
      }
      out.push({ perm, sum, lane, hits, ngHits });
    }
    return out;
  };

  combinations(idx, half).forEach((combo) => {
    const setA = new Set(combo);
    for (let i = 0; i < players.length; i++) {
      const lt = players[i].lockedTeam;
      if (lt === "A" && !setA.has(i)) return;
      if (lt === "B" && setA.has(i)) return;
    }
    const teamA = players.filter((_, i) => setA.has(i));
    const teamB = players.filter((_, i) => !setA.has(i));
    const evA = evalTeam(teamA);
    const evB = evalTeam(teamB);
    if (!evA.length || !evB.length) return;

    for (const a of evA) {
      for (const b of evB) {
        const teamDiff = Math.abs(a.sum - b.sum);
        let laneDiff = 0;
        for (let r = 0; r < 5; r++) {
          const x = a.lane[r], y = b.lane[r];
          if (x === x && y === y) laneDiff += Math.abs(x - y); // NaNチェック
        }
        const balanceScore = teamDiff + 0.5 * laneDiff - 0.05 * (a.sum + b.sum);
        // 段階的優先順位: ①NGレーン回避(最小化・最優先) → ②ロール希望充足数(最大化) → ③レートバランス(最小化)
        const score = (a.ngHits + b.ngHits) * 10000000 - (a.hits + b.hits) * 100000 + balanceScore;
        if (!best || score < best.score) {
          best = { score, diff: teamDiff, laneDiff, prefHits: a.hits + b.hits, ngHits: a.ngHits + b.ngHits, _A: { team: teamA, perm: a.perm }, _B: { team: teamB, perm: b.perm } };
        }
      }
    }
  });

  if (!best) return null;
  const mk = ({ team, perm }) => team
    .map((p, i) => ({ id: p.id, name: p.name, role: perm[i], mu: p.roles[perm[i]].mu, wanted: !!(p.prefRoles && p.prefRoles.includes(perm[i])), isNg: !!(p.ngRoles && p.ngRoles.includes(perm[i])) }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  best.teamA = mk(best._A);
  best.teamB = mk(best._B);
  delete best._A; delete best._B;
  return best;
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
      }],
    };
  });
}

// 全試合を初期値から再計算(試合削除時に使用)
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
  [...matches].sort((a, b) => a.timestamp - b.timestamp).forEach((m) => {
    ps = applyMatchToPlayers(ps, m);
  });
  return ps;
}

/* --------------------------- storage (Firebase RTDB) --------------------------- */

const FB_CONFIG = typeof window !== "undefined" ? window.FIREBASE_CONFIG : null;
let _db = null;
function getDb() {
  if (_db) return _db;
  if (FB_CONFIG && FB_CONFIG.databaseURL) _db = getDatabase(initializeApp(FB_CONFIG));
  return _db;
}
// RTDBはundefinedを拒否し、疎配列をオブジェクト化するため正規化する
const clean = (v) => JSON.parse(JSON.stringify(v ?? null));
const asArray = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);
async function saveShared(key, value) {
  const db = getDb();
  if (!db) return;
  try { await fbSet(ref(db, "customstats/" + key), clean(value)); }
  catch (e) { console.error("storage error", e); }
}
// 試合はID単位で保存: 同時報告の上書き競合を根絶
async function saveMatch(match) {
  const db = getDb();
  if (!db) return;
  try { await fbSet(ref(db, "customstats/matches/" + match.id), clean(match)); }
  catch (e) { console.error("storage error", e); }
}
async function saveSession(session) {
  const db = getDb();
  if (!db) return;
  try { await fbSet(ref(db, "customstats/session"), clean(session)); }
  catch (e) { console.error("storage error", e); }
}
async function removeMatchDb(id) {
  const db = getDb();
  if (!db) return;
  try { await fbRemove(ref(db, "customstats/matches/" + id)); }
  catch (e) { console.error("storage error", e); }
}
// ランク変更申請: 試合と同じくID単位で保存(同時申請の上書き競合を根絶)
async function saveRankRequest(reqObj) {
  const db = getDb();
  if (!db) return;
  try { await fbSet(ref(db, "customstats/rankRequests/" + reqObj.id), clean(reqObj)); }
  catch (e) { console.error("storage error", e); }
}
async function removeRankRequestDb(id) {
  const db = getDb();
  if (!db) return;
  try { await fbRemove(ref(db, "customstats/rankRequests/" + id)); }
  catch (e) { console.error("storage error", e); }
}
// 承認をトランザクション化: 同時承認によるレート二重反映を防止
async function claimApproval(id) {
  const db = getDb();
  if (!db) return false;
  try {
    const res = await runTransaction(ref(db, "customstats/matches/" + id + "/status"),
      (cur) => (cur === "pending" ? "approved" : undefined));
    return res.committed;
  } catch (e) { console.error(e); return false; }
}

/* --------------------------- UI atoms --------------------------- */
// 対面指定ショートカット: 選手X(ブルー) vs 選手Y(レッド) @ レーン を1操作で固定する
function LaneMatchupSetter({ players, onSet }) {
  const [xId, setXId] = useState("");
  const [yId, setYId] = useState("");
  const [role, setRole] = useState("MID");
  const okRole = (p, r) => p && !(p.ngRoles || []).includes(r);
  const px = players.find((p) => p.id === xId);
  const py = players.find((p) => p.id === yId);
  const valid = px && py && xId !== yId && okRole(px, role) && okRole(py, role);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: theme.textSub }}>{t("balance.067")}:</span>
      <select className="cs-input" style={{ padding: "4px 6px", fontSize: 13, borderColor: theme.accentBright }} value={xId} onChange={(e) => setXId(e.target.value)}>
        <option value="">{t("balance.069")}</option>
        {players.filter((p) => p.id !== yId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <span style={{ fontSize: 13, color: theme.textFaint }}>vs</span>
      <select className="cs-input" style={{ padding: "4px 6px", fontSize: 13, borderColor: theme.teamB }} value={yId} onChange={(e) => setYId(e.target.value)}>
        <option value="">{t("balance.069")}</option>
        {players.filter((p) => p.id !== xId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select className="cs-input" style={{ padding: "4px 6px", fontSize: 13 }} value={role} onChange={(e) => setRole(e.target.value)}>
        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <button className="cs-btn" disabled={!valid} style={{ padding: "5px 14px", fontSize: 13, opacity: valid ? 1 : 0.5 }}
        onClick={() => { if (valid) { onSet(xId, yId, role); setXId(""); setYId(""); } }}>
        {t("balance.068")}
      </button>
      {px && py && xId !== yId && !valid && (
        <span style={{ fontSize: 13, color: theme.teamB, fontWeight: 700 }}>
          {t("shell.085", { name: !okRole(px, role) ? px.name : py.name, role })}
        </span>
      )}
    </div>
  );
}

// アイテム効率タブ: UI言語→DDragonロケールコード
const DD_LANG_MAP = { ja: "ja_JP", en: "en_US", ko: "ko_KR" };

// ステータス値の表示フォーマット(%系は%付与、小数は丸め)
function fmtStatValue(key, amount) {
  const v = Math.round(amount * 10) / 10;
  return PERCENT_DISPLAY_KEYS.has(key) ? `${v}%` : `${v}`;
}

function ItemEfficiencyBar({ value }) {
  const pct = Math.max(0, Math.min(150, value));
  const color = value > 100 ? theme.accent : value < 80 ? theme.textFaint : theme.textSub;
  return (
    <div style={{ position: "relative", width: 70, height: 6, background: theme.borderTable, borderRadius: 3, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(pct / 150) * 100}%`, background: color, borderRadius: 3 }} />
      <div style={{ position: "absolute", left: `${(100 / 150) * 100}%`, top: 0, bottom: 0, width: 1, background: theme.text, opacity: 0.4 }} />
    </div>
  );
}

function ItemEfficiencyTab() {
  const lang = getLang();
  const [state, setState] = useState({ status: "loading", items: [], skipped: [] });
  const [tier, setTier] = useState("ALL");
  const [abilityFilters, setAbilityFilters] = useState([]); // 複数選択OR
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("efficiency");
  const [sortDir, setSortDir] = useState("desc");
  const [expandedId, setExpandedId] = useState(null); // モバイル: ステータス内訳のアコーディオン展開
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: "loading" }));
    (async () => {
      try {
        const versions = await (await fetch("https://ddragon.leagueoflegends.com/api/versions.json")).json();
        const ver = versions[0];
        const ddLang = DD_LANG_MAP[lang] || "ja_JP";
        // 統計抽出は常にen_US(descriptionラベルのパースが英語辞書ベースのため)。表示名のみロケール版
        const fetchItemJson = async (locale) => {
          const cacheKey = `crl-items-${ver}-${locale}`;
          try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) return JSON.parse(cached);
          } catch { /* キャッシュ破損時は無視して再取得 */ }
          const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${ver}/data/${locale}/item.json`);
          if (!res.ok) throw new Error("fetch failed");
          const json = await res.json();
          try {
            // 旧バージョンのキャッシュを掃除してから保存(1件500KB超のためパッチ毎の残留で肥大化する)
            Object.keys(localStorage)
              .filter((k) => k.startsWith("crl-items-") && !k.startsWith(`crl-items-${ver}-`))
              .forEach((k) => localStorage.removeItem(k));
            localStorage.setItem(cacheKey, JSON.stringify(json));
          } catch { /* 容量超過等は無視 */ }
          return json;
        };
        const statsData = await fetchItemJson("en_US");
        const namesData = ddLang === "en_US" ? statsData : await fetchItemJson(ddLang);
        const { results, skippedStats, rateInfo } = computeEfficiency(statsData, namesData);
        if (!cancelled) setState({ status: "ready", items: results, skipped: skippedStats, rateInfo, ver });
      } catch (e) {
        if (!cancelled) setState({ status: "error", items: [], skipped: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [lang, reloadTick]);

  const filtered = useMemo(() => {
    let arr = state.items;
    if (tier !== "ALL") arr = arr.filter((it) => it.tier === tier);
    if (abilityFilters.length) {
      // 選択された能力値名グループのいずれかのキーを持つアイテムのみ(OR)
      arr = arr.filter((it) => abilityFilters.some((labelKey) => {
        const grp = ITEM_STAT_FILTER_GROUPS.find((g) => g.labelKey === labelKey);
        return grp && grp.keys.some((k) => it.stats[k] != null);
      }));
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      arr = arr.filter((it) => (it.name || "").toLowerCase().includes(q));
    }
    const dir = sortDir === "asc" ? 1 : -1;
    arr = [...arr].sort((a, b) => {
      if (sortKey === "efficiency") return (a.efficiency - b.efficiency) * dir;
      if (sortKey === "gold") return (a.gold - b.gold) * dir;
      return String(a.name).localeCompare(String(b.name)) * dir;
    });
    return arr;
  }, [state.items, tier, abilityFilters, query, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "name" ? "asc" : "desc"); }
  };
  const toggleAbility = (key) => {
    setAbilityFilters((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  };

  if (state.status === "loading") {
    return (
      <div style={{ ...cardStyle, textAlign: "center", padding: 40, color: theme.textSub }}>
        <Loader2 size={22} className="spin" style={{ marginBottom: 8 }} />
        <div>{t("items.017")}</div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div style={{ ...cardStyle, textAlign: "center", padding: 40 }}>
        <div style={{ color: theme.teamB, fontWeight: 700, marginBottom: 12 }}>{t("items.018")}</div>
        <button className="cs-btn" style={{ padding: "8px 20px" }} onClick={() => setReloadTick((n) => n + 1)}>
          <RefreshCw size={14} style={{ marginRight: 4 }} />{t("items.019")}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ ...cardStyle, marginBottom: 12, fontSize: 13, color: theme.textSub, lineHeight: 1.7 }}>
        {t("items.002")}
        {state.skipped.length > 0 && (
          <div style={{ marginTop: 4 }}>
            {t("items.003")} {state.skipped.map((k) => t(ITEM_STAT_LABEL_KEY[k] || k)).join(" / ")}
          </div>
        )}
        {state.rateInfo && state.rateInfo.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700, color: theme.accent, fontSize: 13 }}>{t("items.041")}</summary>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))", gap: "6px 18px", marginTop: 8 }}>
              {state.rateInfo.map((ri) => (
                <div key={ri.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden" }}>
                  {ri.sourceImage && (
                    <img src={`https://ddragon.leagueoflegends.com/cdn/${state.ver}/img/item/${ri.sourceImage}`}
                      alt="" style={{ width: 18, height: 18, borderRadius: 3, flexShrink: 0 }} />
                  )}
                  <span style={{ fontWeight: 700, flexShrink: 0 }}>{t(ITEM_STAT_LABEL_KEY[ri.key] || ri.key)}</span>
                  <span style={{ color: theme.textFaint, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {Math.round(ri.rate * 10) / 10}G/{PERCENT_DISPLAY_KEYS.has(ri.key) ? "1%" : t("items.042")}{ri.sourceName ? `（${ri.sourceName}）` : ""}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="cs-scroll" style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {ITEM_TIERS.map((tr) => (
          <button key={tr.key} className="cs-btn-ghost"
            style={{ padding: "5px 14px", fontSize: 13, whiteSpace: "nowrap",
              borderColor: tier === tr.key ? theme.accent : theme.borderInput,
              color: tier === tr.key ? theme.accent : theme.textSub,
              fontWeight: tier === tr.key ? 700 : 400 }}
            onClick={() => setTier(tr.key)}>
            {t(tr.labelKey)}
          </button>
        ))}
      </div>

      <div className="cs-scroll" style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {ITEM_STAT_FILTER_GROUPS.map((f) => {
          const on = abilityFilters.includes(f.labelKey);
          return (
            <button key={f.labelKey} className="cs-btn-ghost"
              style={{ padding: "4px 10px", fontSize: 13, whiteSpace: "nowrap",
                background: on ? theme.accent : "transparent",
                color: on ? theme.surface : theme.textSub,
                borderColor: on ? theme.accent : theme.borderInput, fontWeight: on ? 700 : 400 }}
              onClick={() => toggleAbility(f.labelKey)}>
              {t(f.labelKey)}
            </button>
          );
        })}
      </div>

      <input className="cs-input" placeholder={t("items.014")} value={query} onChange={(e) => setQuery(e.target.value)}
        style={{ width: "100%", maxWidth: 320, padding: "7px 10px", fontSize: 14, marginBottom: 12, boxSizing: "border-box" }} />

      {filtered.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: 30, color: theme.textFaint }}>{t("items.020")}</div>
      ) : (
        <div className="cs-scroll" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${theme.borderTable}`, color: theme.textSub }}>
                <th style={{ textAlign: "left", padding: "6px 8px" }}></th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}></th>
                <th style={{ textAlign: "right", padding: "6px 8px", cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("gold")}>
                  {t("items.015")}{sortKey === "gold" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
                <th className="cs-hide-mobile" style={{ textAlign: "left", padding: "6px 8px" }}></th>
                <th style={{ textAlign: "right", padding: "6px 8px", cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("efficiency")}>
                  {t("items.016")}{sortKey === "efficiency" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => {
                const expanded = expandedId === it.id;
                return (
                  <React.Fragment key={it.id}>
                    <tr style={{ borderBottom: `1px solid ${theme.borderTable}`, cursor: "pointer" }}
                      onClick={() => setExpandedId(expanded ? null : it.id)}>
                      <td style={{ padding: "6px 4px", width: 30 }}>
                        {it.image && (
                          <img src={`https://ddragon.leagueoflegends.com/cdn/${state.ver}/img/item/${it.image}`}
                            alt="" style={{ width: 26, height: 26, borderRadius: 4 }} />
                        )}
                      </td>
                      <td style={{ padding: "6px 8px", fontWeight: 700 }}>{it.name}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>{it.gold.toLocaleString()}</td>
                      <td className="cs-hide-mobile" style={{ padding: "6px 8px", fontSize: 12, color: theme.textSub }}>
                        {it.breakdown.map((b) => `${t(ITEM_STAT_LABEL_KEY[b.key] || b.key)} ${fmtStatValue(b.key, b.amount)}`).join(" / ")}
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                          <span style={{ fontWeight: 700, color: it.efficiency > 100 ? theme.accent : it.efficiency < 80 ? theme.textFaint : theme.text }}>
                            {it.efficiency.toFixed(1)}%
                          </span>
                          <ItemEfficiencyBar value={it.efficiency} />
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={5} style={{ padding: "4px 8px 10px 40px", fontSize: 12, color: theme.textSub, borderBottom: `1px solid ${theme.borderTable}` }}>
                          {it.breakdown.map((b) => `${t(ITEM_STAT_LABEL_KEY[b.key] || b.key)} +${fmtStatValue(b.key, b.amount)} (${Math.round(b.goldValue).toLocaleString()}G)`).join(" ・ ")}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Badge({ count }) {
  if (!count) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999,
      background: "#D93025", color: "#FFFFFF",
      fontSize: 11, fontWeight: 700, lineHeight: 1,
      border: "1px solid rgba(255,255,255,.6)",
    }}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function TabButton({ active, onClick, icon: Icon, label, badge }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "9px 14px", borderRadius: 6, border: "none", cursor: "pointer",
      background: active ? "linear-gradient(135deg, var(--cs-headFrom), var(--cs-headTo))" : "transparent",
      color: active ? theme.surface : theme.textSub,
      fontWeight: active ? 700 : 500, fontSize: 17,
      fontFamily: "var(--cs-font)",
      transition: "all .15s", whiteSpace: "nowrap",
      boxShadow: active ? "0 1px 3px rgba(15,95,163,0.35)" : "none",
    }}>
      <Icon size={15} /> {label} <Badge count={badge} />
    </button>
  );
}

function ProfBadge({ prof }) {
  const colors = { "◎": theme.profGreat, "〇": theme.profGood, "△": theme.profFair, "×": theme.profWeak };
  return <span style={{ color: colors[prof], fontWeight: 700 }}>{prof}</span>;
}

/* --------------------------- main app --------------------------- */
export default function CustomStats() {
  const [tab, setTab] = useState("attendance");
  const [players, setPlayers] = useState([]);
  const [matches, setMatches] = useState([]);
  const [rankRequests, setRankRequests] = useState([]); // ランク変更申請(承認待ち)
  const [loading, setLoading] = useState(true);

  // player registration
  const [newPlayerName, setNewPlayerName] = useState("");
  const [newSummoner, setNewSummoner] = useState("");
  const [newProfs, setNewProfs] = useState({ TOP: "△", JG: "△", MID: "△", ADC: "△", SUP: "△" });
  const [newRank, setNewRank] = useState("アンランク");

  // report form: entries = [{playerId, team, role}]
  const [entries, setEntries] = useState([]);
  const [winner, setWinner] = useState("");
  const [kdaInputs, setKdaInputs] = useState({});
  const [reporterName, setReporterName] = useState("");
  const [ocrBusy, setOcrBusy] = useState("");
  const [ocrRows, setOcrRows] = useState(null); // [{ocrName, playerId, teamNo(1|2), champion, k,d,a}]
  const [ocrActiveRow, setOcrActiveRow] = useState(null); // directモード: 現在割当中の行index
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState(null); // 確認用フルサイズ画像(objectURL)
  const [reportImage, setReportImage] = useState(null); // base64 thumbnail

  const [customChamps, setCustomChamps] = useState([]);
  const [ddChamps, setDdChamps] = useState(null); // [{name, img}] 最新パッチ(Data Dragon)
  const [ddVer, setDdVer] = useState(null);
  const [ioText, setIoText] = useState("");
  const [ioMsg, setIoMsg] = useState("");
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState(null); // {name, rank, profs}
  const [editError, setEditError] = useState("");

  const [balanceResult, setBalanceResult] = useState(undefined); // undefined=未実行, null=割当不能
  // 運用設定(全端末共有・管理者PASSで変更)。customstats/settings を購読する。
  const [settings, setSettings] = useState({ matchupWarnThreshold: MATCHUP_WARN_DEFAULT });
  const matchupThreshold = settings.matchupWarnThreshold;
  const [swapSel, setSwapSel] = useState(null); // { team:'A'|'B', idx:number } タップ入替の1人目選択
  const [subPickerOpen, setSubPickerOpen] = useState(false); // 選手交代の交代先選択パネル開閉
  const [copiedRiotId, setCopiedRiotId] = useState(null); // Riot IDコピー時の一時フィードバック表示
  const [champExpanded, setChampExpanded] = useState(false); // 個人成績: チャンピオン別成績の全件表示
  const [dialog, setDialog] = useState(null); // テーマ準拠ダイアログ {type, content, resolve, password, defaultValue}
  const [dialogInput, setDialogInput] = useState("");
  useEffect(() => { _dialogSet = (d) => { setDialogInput(d.defaultValue || ""); setDialog(d); }; return () => { _dialogSet = null; }; }, []);
  const closeDialog = (value) => { const d = dialog; setDialog(null); if (d && d.resolve) d.resolve(value); };
  const balanceCardRef = useRef(null); // 画像コピー対象DOM(チーム分け結果+バン保護枠)
  const [banInput, setBanInput] = useState({ A: "", B: "" }); // バン保護枠の入力中テキスト(チームごと)
  const [rankReqOpenFor, setRankReqOpenFor] = useState(null); // ランク変更申請フォームを開いている選手ID
  const [rankReqValue, setRankReqValue] = useState("アンランク");
  const [rankReqProfs, setRankReqProfs] = useState({});
  const [session, setSession] = useState({ roster: [], prefs: {}, resetAt: 0, balance: null }); // {roster:[playerId], prefs:{playerId:{team,roles,force}}, resetAt, balance:チーム分け結果(共有)}
  const [chartPlayerId, setChartPlayerId] = useState(null);
  const [expandedMatch, setExpandedMatch] = useState(null);
  const [editMatchId, setEditMatchId] = useState(null);
  const [editMatchForm, setEditMatchForm] = useState(null);
  const [editMatchError, setEditMatchError] = useState("");
  const [chartRole, setChartRole] = useState("TOP");
  const [boardRole, setBoardRole] = useState("MAIN");
  const [statsPlayerId, setStatsPlayerId] = useState(null);
  const [scoutPlayerId, setScoutPlayerId] = useState(null);
  const [statsPickerOpen, setStatsPickerOpen] = useState(false);
  const [statsSearch, setStatsSearch] = useState("");
  const [statsSubTab, setStatsSubTab] = useState("overview");
  const [statsLogFilter, setStatsLogFilter] = useState("ALL");
  // 出欠ボード: 「自分」の識別は自己申告(端末localStorage)。本人確認ではない。
  const [myPlayerId, setMyPlayerIdState] = useState(() => {
    try { return localStorage.getItem("crl-my-player-id") || null; } catch { return null; }
  });
  const [myPickerOpen, setMyPickerOpen] = useState(false);
  const [myPickerSearch, setMyPickerSearch] = useState("");
  const [selfForm, setSelfForm] = useState({ from: "", to: "", memo: "" });
  const [attendExpanded, setAttendExpanded] = useState({ active: false, adjust: false, rest: false, noResponse: false });
  // 選手一覧タブ: 検索・表示件数
  const [playerSearch, setPlayerSearch] = useState("");
  const [listLimit, setListLimit] = useState(20);
  const myPlayerSyncedRef = useRef(null);
  useEffect(() => {
    if (!myPlayerId || !players.length || myPlayerSyncedRef.current === myPlayerId) return;
    const p = players.find((x) => x.id === myPlayerId);
    if (p) {
      setSelfForm({ from: p.availFrom || "", to: p.availTo || "", memo: p.memo || "" });
      myPlayerSyncedRef.current = myPlayerId;
    }
  }, [myPlayerId, players]);
  const chooseMyPlayer = (id) => {
    try { localStorage.setItem("crl-my-player-id", id); } catch {}
    myPlayerSyncedRef.current = null;
    setMyPlayerIdState(id);
    setMyPickerOpen(false);
    setMyPickerSearch("");
  };
  const [playerSort, setPlayerSort] = useState("name");
  const [playerFilter, setPlayerFilter] = useState("all"); // all | active | rest | adjust
  const [recordSubTab, setRecordSubTab] = useState("kill1");
  const [recordRole, setRecordRole] = useState("ALL");
  const [recordSelectedPlayerId, setRecordSelectedPlayerId] = useState(null);

  const [dbError, setDbError] = useState("");
  const [gateOk, setGateOk] = useState(() => !VIEW_PASS || (typeof localStorage !== "undefined" && localStorage.getItem("crl-gate") === VIEW_PASS));

  // テーマカラー・書体(端末ローカルの表示設定。他人とは共有しない)
  const [colorKey, setColorKey] = useState(() => (typeof localStorage !== "undefined" && localStorage.getItem("crl-color")) || "sky");
  // 既定書体を gothic に変更(2026-08)。旧既定を明示的に選んでいない人だけ移行する。
  if (typeof localStorage !== "undefined" && !localStorage.getItem("crl-font-migrated-v1")) {
    try {
      if (localStorage.getItem("crl-font") === "kyokasho") localStorage.removeItem("crl-font");
      localStorage.setItem("crl-font-migrated-v1", "1");
    } catch {}
  }
  const [fontKey, setFontKey] = useState(() => (typeof localStorage !== "undefined" && localStorage.getItem("crl-font")) || "gothic");
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  useEffect(() => {
    applyTheme(colorKey, fontKey);
    try { localStorage.setItem("crl-color", colorKey); localStorage.setItem("crl-font", fontKey); } catch {}
  }, [colorKey, fontKey]);

  // 表示言語(端末ローカル。初回はブラウザ言語を自動判定。Discordコピー文面は常に日本語固定)
  const [lang, setLangState] = useState(() => initialLang());
  setLang(lang); // 同期反映(このレンダー内のt()呼び出しに即座に反映させるため)
  useEffect(() => {
    try { localStorage.setItem("crl-lang", lang); } catch {}
    try { document.documentElement.lang = lang; } catch {}
  }, [lang]);
  const [gateInput, setGateInput] = useState("");

  // Firebaseリアルタイム購読: 他ユーザーの更新が即時反映される
  useEffect(() => {
    const db = getDb();
    if (!db) { setLoading(false); return; }
    const onErr = (e) => { console.error(e); setDbError(t("shell.001")); setLoading(false); };
    const un1 = onValue(ref(db, "customstats/players"), (snap) => {
      const migrated = asArray(snap.val()).map(migratePlayer);
      setPlayers(migrated);
      setChartPlayerId((cur) => cur || (migrated.length ? migrated[0].id : null));
      setLoading(false);
    }, onErr);
    const un2 = onValue(ref(db, "customstats/matches"), (snap) => setMatches(asArray(snap.val())), onErr);
    const un2b = onValue(ref(db, "customstats/rankRequests"), (snap) => setRankRequests(asArray(snap.val())), onErr);
    const un3 = onValue(ref(db, "customstats/champions"), (snap) => setCustomChamps(asArray(snap.val())), onErr);
    const un4 = onValue(ref(db, "customstats/session"), (snap) => {
      const v = snap.val() || {};
      setSession({ roster: asArray(v.roster), prefs: v.prefs || {}, resetAt: v.resetAt || 0, balance: v.balance || null });
      // チーム分け結果は共有session経由で全端末に反映する(自端末での再実行を不要にするため)
      setBalanceResult(v.balance || undefined);
    }, onErr);
    const un5 = onValue(ref(db, "customstats/settings"), (snap) => {
      const v = snap.val() || {};
      // RTDBは空オブジェクトを剪定するため、未設定時は既定値にフォールバックする
      setSettings({ matchupWarnThreshold: clampMatchupWarn(v.matchupWarnThreshold ?? MATCHUP_WARN_DEFAULT) });
    }, onErr);
    return () => { un1(); un2(); un2b(); un3(); un4(); un5(); };
  }, []);

  // Data Dragon: 最新パッチのチャンピオン一覧(日本語)と画像キーを取得
  useEffect(() => {
    (async () => {
      try {
        const vers = await (await fetch("https://ddragon.leagueoflegends.com/api/versions.json")).json();
        const ver = vers[0];
        const data = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${ver}/data/ja_JP/champion.json`)).json();
        // Classic版を除外したうえで表示名一意化。将来別系統の重複が増えても
        // key が小さい方(オリジナル)を残すことで通常版を優先する。
        const byName = new Map();
        Object.values(data.data).forEach((ch) => {
          if (isClassicChamp(ch)) return;
          const prev = byName.get(ch.name);
          if (!prev || Number(ch.key) < Number(prev.key)) {
            byName.set(ch.name, { name: ch.name, img: ch.image.full, key: ch.key });
          }
        });
        const list = [...byName.values()].map(({ name, img }) => ({ name, img }));
        list.sort((a, b) => a.name.localeCompare(b.name, "ja"));
        setDdChamps(list);
        setDdVer(ver);
      } catch (e) {
        console.warn(t("shell.002"), e);
      }
    })();
  }, []);

  // 端末内自動バックアップ(同期のたびに最新スナップショットを保存、10分間隔で世代保存)
  useEffect(() => {
    if (loading || (!players.length && !matches.length)) return;
    try {
      const snap = JSON.stringify({ players, matches, customChamps, savedAt: Date.now() });
      const hist = JSON.parse(localStorage.getItem("crl-backup-gens") || "[]");
      if (!hist.length || Date.now() - hist[0].savedAt > 10 * 60 * 1000) {
        hist.unshift({ savedAt: Date.now(), data: snap });
        localStorage.setItem("crl-backup-gens", JSON.stringify(hist.slice(0, 3)));
      }
      localStorage.setItem("crl-backup", snap);
    } catch {}
  }, [players, matches, customChamps, loading]);

  const persist = useCallback(async (nextPlayers, nextMatches) => {
    if (nextPlayers) await saveShared("players", nextPlayers);
    if (nextMatches) await saveShared("matches", Object.fromEntries(nextMatches.map((m) => [m.id, m])));
  }, []);

  const resetNewPlayerForm = () => {
    setNewPlayerName("");
    setNewSummoner("");
    setNewProfs({ TOP: "△", JG: "△", MID: "△", ADC: "△", SUP: "△" });
    setNewRank("アンランク");
  };
  const addPlayer = async () => {
    const name = newPlayerName.trim();
    if (!name || players.some((p) => p.name === name)) return;
    const baseMu = RANKS.find(([label]) => label === newRank)?.[1] ?? MU0;
    const p = {
      id: crypto.randomUUID(), name,
      rank: newRank,
      summonerName: newSummoner.trim(),
      roles: initRoles(newProfs, baseMu, newRank === "アンランク" || newRank === "初心者"),
      baseMu,
      status: "active",
      adjust: false,
      prefRoles: [],
      wins: 0, losses: 0, kdaHistory: [],
    };
    const next = [...players, p];
    setPlayers(next);
    resetNewPlayerForm();
    await persist(next, null);
  };

  const removePlayer = async (id) => {
    const p = players.find((x) => x.id === id);
    if (!(await requireAdminPass(t("shell.072", { name: p?.name })))) return;
    const next = players.filter((x) => x.id !== id);
    setPlayers(next);
    await persist(next, null);
  };

  const addEntry = (playerId, team) => {
    if (!playerId || entries.some((e) => e.playerId === playerId)) return;
    setEntries([...entries, { playerId, team, role: "MID", champion: "" }]);
  };
  const setEntryRole = (playerId, role) =>
    setEntries(entries.map((e) => (e.playerId === playerId ? { ...e, role } : e)));
  const setEntryChampion = (playerId, champion) =>
    setEntries(entries.map((e) => (e.playerId === playerId ? { ...e, champion } : e)));
  const removeEntry = (playerId) =>
    setEntries(entries.filter((e) => e.playerId !== playerId));

  const teamOf = (t) => entries.filter((e) => e.team === t);

  const setOcrPreview = (file) => {
    if (ocrPreviewUrl) URL.revokeObjectURL(ocrPreviewUrl);
    setOcrPreviewUrl(URL.createObjectURL(file));
  };
  const clearOcr = () => {
    setOcrRows(null);
    if (ocrPreviewUrl) { URL.revokeObjectURL(ocrPreviewUrl); setOcrPreviewUrl(null); }
  };

  // 転記済みメンバーへのKDA読み込み: 名前OCR・チャンピオン照合(いずれも実地精度が低い)を行わず、
  // 高精度なKDA数値だけを読み取る。行と選手の対応はユーザーがボタンタップで指定する(タップで次行へ自動送り)。
  const runOcrDirect = async (file) => {
    try {
      setOcrBusy(t("shell.007"));
      const img = await fileToImage(file);
      setReportImage(toThumbnailBase64(img));
      setOcrPreview(file);

      const kdaRows = analyzeKda(img).filter((r) => r.kda).slice(0, 10);
      if (kdaRows.length < 4) {
        setOcrBusy("");
        themedAlert(t("shell.008"));
        return;
      }
      const half = Math.ceil(kdaRows.length / 2);
      const rows = kdaRows.map((r, i) => ({
        ocrName: "",
        playerId: "",
        teamNo: i < half ? 1 : 2,
        champion: "",
        k: r.kda ? r.kda[0] : "", d: r.kda ? r.kda[1] : "", a: r.kda ? r.kda[2] : "",
      }));
      setOcrActiveRow(0);
      setOcrRows(rows);
      setOcrBusy("");
    } catch (e) {
      console.error(e);
      setOcrBusy("");
      themedAlert(t("shell.009") + " " + (e.message || e) + "\n" + t("shell.010"));
    }
  };

  // タップ割当: activeな行に選手を割当て、次の未割当行へ自動送り。既に割当済みの選手をタップした場合は付け替え
  const assignPlayerToActiveRow = (playerId) => {
    if (!ocrRows || ocrActiveRow == null) return;
    const next = ocrRows.map((r, i) => {
      if (i === ocrActiveRow) return { ...r, playerId };
      if (r.playerId === playerId) return { ...r, playerId: "" }; // 付け替え(旧行から外す)
      return r;
    });
    setOcrRows(next);
    const nextIdx = next.findIndex((r, i) => i !== ocrActiveRow && !r.playerId);
    setOcrActiveRow(nextIdx === -1 ? null : nextIdx);
  };

  const applyOcrToForm = () => {
    // KDAのみ更新。チーム・ロール・チャンピオンは一切変更しない
    const valid = ocrRows.filter((r) => r.playerId);
    const newKda = { ...kdaInputs };
    valid.forEach((r) => {
      if (r.k !== "" || r.d !== "" || r.a !== "") newKda[r.playerId] = { k: Number(r.k) || 0, d: Number(r.d) || 0, a: Number(r.a) || 0 };
    });
    setKdaInputs(newKda);
    clearOcr();
  };

  const submitReport = async () => {
    if (teamOf("A").length === 0 || teamOf("B").length === 0 || !winner) return;
    const match = {
      id: crypto.randomUUID(),
      entries: entries.map((e) => ({ ...e, champion: champCanonical(e.champion) })), winner,
      kda: kdaInputs,
      reporter: reporterName || t("shell.012"),
      timestamp: Date.now(),
      status: "pending",
      image: reportImage || null,
    };
    // 重複報告チェック: 30分以内・同一メンバー構成
    const memberKey = (es) => es.map((e) => e.playerId).sort().join(",");
    const dup = matches.find((m) =>
      Math.abs(m.timestamp - match.timestamp) < 30 * 60 * 1000 &&
      memberKey(m.entries) === memberKey(match.entries));
    if (dup) {
      const ok = await themedConfirm(t("shell.074", { status: dup.status === "pending" ? t("shell.013") : t("shell.014") }));
      if (!ok) return;
    }
    setMatches([...matches, match]);
    await saveMatch(match);
    // 未知のチャンピオン名を共有リストへ自動追加
    const known = new Set([...(ddChamps ? ddChamps.map((x) => x.name) : CHAMPIONS), ...customChamps]);
    const newNames = entries.map((e) => e.champion.trim()).filter((n) => n && !known.has(n));
    if (newNames.length) {
      const nextCC = [...customChamps, ...Array.from(new Set(newNames))];
      setCustomChamps(nextCC);
      await saveShared("champions", nextCC);
    }
    setEntries([]); setKdaInputs({}); setReporterName(""); setWinner("");
    setReportImage(null); setOcrRows(null);
    setTab("pending");
  };

  // PASS認証: 承認(レート反映) / 却下(破棄)
  const approveMatch = async (matchId) => {
    if (!(await requireAdminPass(t("shell.015")))) return;
    const match = matches.find((m) => m.id === matchId);
    if (!match || match.status !== "pending") return;
    // 原子的にpending→approvedへ。他端末が先に承認済みなら中断(レート二重反映防止)
    const claimed = await claimApproval(matchId);
    if (!claimed) { themedAlert(t("shell.016")); return; }
    const nextPlayers = applyMatchToPlayers(players, match);
    setPlayers(nextPlayers);
    setMatches(matches.map((m) => (m.id === matchId ? { ...m, status: "approved", image: null } : m)));
    await saveShared("players", nextPlayers);
    // 承認後は添付画像を削除(容量節約)
    const db = getDb();
    if (db && match.image) { try { await fbSet(ref(db, "customstats/matches/" + matchId + "/image"), null); } catch {} }
  };

  const rejectMatch = async (matchId) => {
    if (!(await requireAdminPass(t("shell.017")))) return;
    setMatches(matches.filter((m) => m.id !== matchId));
    await removeMatchDb(matchId);
  };

  // PASS認証つき試合削除 → 全レート再計算
  const deleteMatch = async (matchId) => {
    if (!(await requireAdminPass(t("shell.018")))) return;
    const nextMatches = matches.filter((m) => m.id !== matchId);
    const nextPlayers = recomputeAll(players, nextMatches);
    setMatches(nextMatches);
    setPlayers(nextPlayers);
    await removeMatchDb(matchId);
    await saveShared("players", nextPlayers);
  };

  const startEdit = (p) => {
    const profs = {};
    ROLES.forEach((r) => { profs[r] = p.roles[r].prof; });
    setEditId(p.id);
    setEditForm({ name: p.name, rank: p.rank || "アンランク", summonerName: p.summonerName || "", profs, status: p.status === "rest" ? "rest" : "active", adjust: !!p.adjust, honorRank: p.honorRank || "" });
    setEditError("");
  };

  // ランク変更申請: 誰でもPASS不要で申請できる。反映は管理者の承認が必要。
  // 1選手につき同時に1件まで(既に申請中なら新規申請させない。取消してからやり直す)
  const submitRankRequest = async (playerId, toRank, toProfs) => {
    const p = players.find((x) => x.id === playerId);
    if (!p) return;
    if (rankRequests.some((r) => r.playerId === playerId)) { themedAlert(t("shell.019")); return; }
    const fromProfs = {};
    ROLES.forEach((r) => { fromProfs[r] = p.roles[r].prof; });
    const rankChanged = toRank !== p.rank;
    const profsChanged = ROLES.some((r) => toProfs[r] !== fromProfs[r]);
    if (!rankChanged && !profsChanged) { themedAlert(t("shell.020")); return; }
    const reqObj = { id: crypto.randomUUID(), playerId, playerName: p.name, fromRank: p.rank, toRank, fromProfs, toProfs, ts: Date.now() };
    setRankRequests([...rankRequests, reqObj]);
    await saveRankRequest(reqObj);
  };
  const cancelRankRequest = async (id) => {
    setRankRequests(rankRequests.filter((r) => r.id !== id));
    await removeRankRequestDb(id);
  };
  const approveRankRequest = async (id) => {
    const req = rankRequests.find((r) => r.id === id);
    if (!req) return;
    const changeLines = [];
    if (req.toRank !== req.fromRank) changeLines.push(`ランク: ${req.fromRank}→${req.toRank}`);
    ROLES.forEach((r) => { if (req.toProfs[r] !== req.fromProfs[r]) changeLines.push(`${r}: ${req.fromProfs[r]}→${req.toProfs[r]}`); });
    if (!(await requireAdminPass(t("shell.076", { name: req.playerName, lines: changeLines.join(" / ") })))) return;
    const baseMu = RANKS.find(([label]) => label === req.toRank)?.[1] ?? MU0;
    let next = players.map((p) => {
      if (p.id !== req.playerId) return p;
      const roles = { ...p.roles };
      ROLES.forEach((r) => { roles[r] = { ...roles[r], prof: req.toProfs[r] }; });
      const np = { ...p, rank: req.toRank, baseMu, roles };
      // 申告ランクが上がって名誉レートを追い越した場合、名誉レートは役目を終えるので解除する
      // (下方向指定と同じ状態になるのを防ぐ)
      if (np.honorRank) {
        const hm = rankMu(np.honorRank);
        if (hm == null || hm <= baseMu) delete np.honorRank;
      }
      return np;
    });
    // ランク/熟練度変更(初期値変更)が過去試合に波及するため全再計算
    next = recomputeAll(next, matches.filter((m) => m.status === "approved"));
    setPlayers(next);
    setRankRequests(rankRequests.filter((r) => r.id !== id));
    await persist(next, null);
    await removeRankRequestDb(id);
  };
  const rejectRankRequest = async (id) => {
    const req = rankRequests.find((r) => r.id === id);
    if (!req) return;
    if (!(await requireAdminPass(t("shell.077", { name: req.playerName })))) return;
    setRankRequests(rankRequests.filter((r) => r.id !== id));
    await removeRankRequestDb(id);
  };

  const saveEdit = async () => {
    const name = editForm.name.trim();
    if (!name) { setEditError(t("shell.022")); return; }
    if (players.some((p) => p.name === name && p.id !== editId)) { setEditError(t("shell.023")); return; }
    if (!(await requireAdminPass(t("shell.024")))) return;
    const baseMu = RANKS.find(([label]) => label === editForm.rank)?.[1] ?? MU0;
    // 名誉レートは申告ランクより上位のみ許可(格下げ扱いになる下方向指定を防ぐ)
    const honorRank = editForm.honorRank || "";
    if (honorRank) {
      const hm = rankMu(honorRank);
      if (hm == null || hm <= baseMu) { setEditError(t("players.049")); return; }
    }
    let next = players.map((p) => {
      if (p.id !== editId) return p;
      const roles = { ...p.roles };
      ROLES.forEach((r) => { roles[r] = { ...roles[r], prof: editForm.profs[r] }; });
      const np = { ...p, name, rank: editForm.rank, summonerName: editForm.summonerName.trim(), baseMu, roles, status: editForm.status, adjust: !!editForm.adjust };
      if (honorRank) np.honorRank = honorRank; else delete np.honorRank;
      return np;
    });
    // 初期値変更が過去試合に波及するため全再計算
    next = recomputeAll(next, matches.filter((m) => m.status === "approved"));
    setPlayers(next);
    setEditId(null); setEditForm(null);
    await persist(next, null);
  };

  const exportData = () => {
    const json = JSON.stringify({ players, matches, customChamps, exportedAt: Date.now() });
    setIoText(json);
    try {
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `customstats-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setIoMsg(t("shell.025"));
    } catch {
      setIoMsg(t("shell.026"));
    }
  };

  const exportCsv = () => {
    const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const rows = [[t("shell.027"), t("shell.028"), t("shell.029"), t("shell.030"), t("shell.031"), "K", "D", "A", t("shell.032"), t("shell.033")]];
    [...approvedMatches].sort((a, b) => a.timestamp - b.timestamp).forEach((m) => {
      m.entries.forEach((e) => {
        const kda = (m.kda || {})[e.playerId] || {};
        rows.push([
          new Date(m.timestamp).toLocaleString(dateLocale()), nameOf(e.playerId), e.team, e.role,
          champLabel(e.champion) || "", kda.k ?? "", kda.d ?? "", kda.a ?? "",
          e.team === m.winner ? t("shell.034") : t("shell.035"), m.reporter,
        ]);
      });
    });
    const csv = "\uFEFF" + rows.map((r) => r.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `customstats-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // シーズンリセット: バックアップDL→試合全削除→レート50%圧縮持ち越し
  // 計算式変更時などに、登録済みの試合履歴から連勝/連敗カウント込みで全レートを再計算
  const recomputeStreaks = async () => {
    if (!(await requireAdminPass(t("shell.036")))) return;
    const nextPlayers = recomputeAll(players, matches.filter((m) => m.status === "approved"));
    setPlayers(nextPlayers);
    await saveShared("players", nextPlayers);
    setIoMsg(t("shell.037"));
  };

  const resetSeason = async () => {
    if (!(await requireAdminPass(t("shell.038")))) return;
    if (!(await themedConfirm(t("shell.039")))) return;
    exportData();
    const nextPlayers = players.map((p) => {
      const unranked = p.rank === "アンランク" || p.rank === "初心者" || !p.rank;
      const init = initRoles(
        Object.fromEntries(ROLES.map((r) => [r, p.roles[r].prof])),
        effectiveBaseMu(p), unranked
      );
      const roles = {};
      ROLES.forEach((r) => {
        roles[r] = { ...init[r], mu: Math.round(((init[r].mu + p.roles[r].mu) / 2) * 10) / 10 };
      });
      return { ...p, roles, wins: 0, losses: 0, kdaHistory: [] };
    });
    setPlayers(nextPlayers);
    setMatches([]);
    const db = getDb();
    if (db) { try { await fbRemove(ref(db, "customstats/matches")); } catch (e) { console.error(e); } }
    await saveShared("players", nextPlayers);
    setIoMsg(t("shell.040"));
  };

  const removeCustomChamp = async (name) => {
    if (!(await requireAdminPass(t("shell.078", { name })))) return;
    const next = customChamps.filter((c) => c !== name);
    setCustomChamps(next);
    await saveShared("champions", next);
  };

  // ロール枠クリックのサイクル: 通常 → 希望(★) → NG(✕、絶対にやりたくないレーン) → 通常
  // 希望とNGは排他(片方を設定するともう片方は自動解除)
  const cyclePrefRole = async (id, role) => {
    const next = players.map((p) => {
      if (p.id !== id) return p;
      const pref = p.prefRoles || [], ng = p.ngRoles || [];
      if (pref.includes(role)) {
        // 希望 → NG
        return { ...p, prefRoles: pref.filter((r) => r !== role), ngRoles: [...ng, role], respondedAt: Date.now() };
      }
      if (ng.includes(role)) {
        // NG → 通常
        return { ...p, ngRoles: ng.filter((r) => r !== role), respondedAt: Date.now() };
      }
      // 通常 → 希望
      return { ...p, prefRoles: [...pref, role], respondedAt: Date.now() };
    });
    setPlayers(next);
    await saveShared("players", next);
  };

  // バン保護枠(チーム単位)。個々の選手ではなくブルー/レッドサイドそれぞれが宣言する。
  // balanceResult.banProtect = { A: [champion,...], B: [champion,...] } として管理し、
  // 他のチーム分け情報と同じくsession.balance経由で全端末に同期する。
  const updateBanProtect = async (team, list) => {
    const next = { ...balanceResult, banProtect: { ...(balanceResult.banProtect || { A: [], B: [] }), [team]: list } };
    setBalanceResult(next);
    const nextSession = { ...session, balance: next };
    setSession(nextSession);
    await saveSession(nextSession);
  };
  const addBanProtect = (team, champion) => {
    const champ = champCanonical(champion.trim());
    if (!champ) return;
    const cur = (balanceResult.banProtect || { A: [], B: [] })[team] || [];
    if (cur.includes(champ)) return;
    updateBanProtect(team, [...cur, champ]);
  };
  const removeBanProtect = (team, champion) => {
    const cur = (balanceResult.banProtect || { A: [], B: [] })[team] || [];
    updateBanProtect(team, cur.filter((c) => c !== champion));
  };

  // html2canvas動的ロード(Tesseract.jsと同じ遅延ロードパターン)
  const html2canvasPromiseRef = useRef(null);
  const loadHtml2Canvas = () => {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (html2canvasPromiseRef.current) return html2canvasPromiseRef.current;
    html2canvasPromiseRef.current = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      s.onload = () => res(window.html2canvas);
      s.onerror = () => rej(new Error(t("shell.041")));
      document.head.appendChild(s);
    });
    return html2canvasPromiseRef.current;
  };

  const [imgCopyBusy, setImgCopyBusy] = useState(false);
  const copyBalanceImage = async (node) => {
    if (!node) return;
    setImgCopyBusy(true);
    try {
      const html2canvas = await loadHtml2Canvas();
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--cs-surface").trim() || "#FFFFFF";
      const canvas = await html2canvas(node, { backgroundColor: bg, scale: 2 });
      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error(t("shell.042"));
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        themedAlert(t("shell.043"));
      } catch {
        // クリップボード非対応環境: ダウンロードにフォールバック
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "team-balance.png"; a.click();
        URL.revokeObjectURL(url);
        themedAlert(t("shell.044"));
      }
    } catch (e) {
      themedAlert(t("shell.045") + " " + (e.message || e));
    } finally {
      setImgCopyBusy(false);
    }
  };

  // 休みと調整枠は排他: 片方をONにするともう片方は解除
  // 自分の状態を触る操作は「出欠ボード」の未回答判定(respondedAt)も更新する
  const toggleRest = async (id) => {
    const next = players.map((p) => (p.id === id
      ? (p.status === "rest" ? { ...p, status: "active", respondedAt: Date.now() } : { ...p, status: "rest", adjust: false, respondedAt: Date.now() })
      : p));
    setPlayers(next);
    await saveShared("players", next);
  };
  const toggleAdjust = async (id) => {
    const next = players.map((p) => (p.id === id
      ? (p.adjust ? { ...p, adjust: false, respondedAt: Date.now() } : { ...p, adjust: true, status: "active", respondedAt: Date.now() })
      : p));
    setPlayers(next);
    await saveShared("players", next);
  };
  // 出欠ボードの3択(参加する/調整枠/休み)から状態を一括で確定させる
  const setParticipation = async (id, mode) => {
    const next = players.map((p) => (p.id !== id ? p : {
      ...p, status: mode === "rest" ? "rest" : "active", adjust: mode === "adjust", respondedAt: Date.now(),
    }));
    setPlayers(next);
    await saveShared("players", next);
  };
  const saveMyAvailability = async (id, form) => {
    const next = players.map((p) => (p.id !== id ? p : {
      ...p, availFrom: form.from.trim(), availTo: form.to.trim(), memo: form.memo.trim(), respondedAt: Date.now(),
    }));
    setPlayers(next);
    await saveShared("players", next);
  };

  const setAllInactive = async (flag) => {
    if (!(await requireAdminPass(t("shell.079", { status: flag ? t("shell.046") : t("shell.047") })))) return;
    const next = players.map((p) => ({ ...p, status: flag ? "rest" : "active" }));
    setPlayers(next);
    await saveShared("players", next);
  };

  const restoreLocalBackup = async () => {
    try {
      const gens = JSON.parse(localStorage.getItem("crl-backup-gens") || "[]");
      const latest = localStorage.getItem("crl-backup");
      if (!latest && !gens.length) { setIoMsg(t("shell.048")); return; }
      const opts = [latest && { label: t("shell.049"), data: latest }, ...gens.map((g, i) => ({ label: t("shell.080", { n: i + 1, date: new Date(g.savedAt).toLocaleString(dateLocale()) }), data: g.data }))].filter(Boolean);
      const pick = await themedPrompt(t("shell.081", { list: opts.map((o, i) => `${i}: ${o.label}`).join("\n") }), { defaultValue: "0" });
      if (pick === null) return;
      const sel = opts[Number(pick)] || opts[0];
      setIoText(sel.data);
      setIoMsg(t("shell.050"));
    } catch { setIoMsg(t("shell.051")); }
  };

  const importData = async () => {
    try {
      const d = JSON.parse(ioText);
      if (!Array.isArray(d.players) || !Array.isArray(d.matches)) throw new Error();
      if (!(await requireAdminPass(t("shell.052")))) return;
      setPlayers(d.players.map(migratePlayer));
      setMatches(d.matches);
      const cc = Array.isArray(d.customChamps) ? d.customChamps : [];
      setCustomChamps(cc);
      await persist(d.players, d.matches);
      await saveShared("champions", cc);
      setIoMsg(t("shell.053"));
    } catch {
      setIoMsg(t("shell.054"));
    }
  };

  const startEditMatch = (m) => {
    setEditMatchId(m.id);
    setEditMatchForm({
      entries: m.entries.map((e) => ({ ...e })),
      winner: m.winner,
      kda: JSON.parse(JSON.stringify(m.kda || {})),
    });
    setEditMatchError("");
  };
  const setEditEntryField = (idx, field, value) =>
    setEditMatchForm({ ...editMatchForm, entries: editMatchForm.entries.map((e, i) => (i === idx ? { ...e, [field]: value } : e)) });
  const setEditKda = (playerId, field, value) =>
    setEditMatchForm({ ...editMatchForm, kda: { ...editMatchForm.kda, [playerId]: { ...editMatchForm.kda[playerId], [field]: Math.max(0, Math.min(100, Number(value))) } } });
  // 選手の入れ替え(誤登録の修正用)。KDA記録も新しいplayerIdへ引き継ぐ
  const setEntryPlayer = (idx, newPlayerId) => {
    const oldEntry = editMatchForm.entries[idx];
    const oldId = oldEntry.playerId;
    const nextEntries = editMatchForm.entries.map((e, i) => (i === idx ? { ...e, playerId: newPlayerId } : e));
    const nextKda = { ...editMatchForm.kda };
    if (oldId !== newPlayerId) {
      nextKda[newPlayerId] = editMatchForm.kda[oldId] || {};
      delete nextKda[oldId];
    }
    setEditMatchForm({ ...editMatchForm, entries: nextEntries, kda: nextKda });
  };

  const saveMatchEdit = async () => {
    const ids = editMatchForm.entries.map((e) => e.playerId);
    if (new Set(ids).size !== ids.length) { setEditMatchError(t("shell.055")); return; }
    const orig = matches.find((m) => m.id === editMatchId);
    if (!orig) return;
    if (!(await requireAdminPass(orig.status === "approved" ? t("shell.056") : t("shell.057")))) return;
    const updated = { ...orig, entries: editMatchForm.entries.map((e) => ({ ...e, champion: champCanonical(e.champion) })), winner: editMatchForm.winner, kda: editMatchForm.kda };
    const nextMatches = matches.map((m) => (m.id === editMatchId ? updated : m));
    if (orig.status === "approved") {
      // レート反映済み試合の修正は全再計算が必要
      const nextPlayers = recomputeAll(players, nextMatches.filter((m) => m.status === "approved"));
      setPlayers(nextPlayers);
      await saveShared("players", nextPlayers);
    }
    setMatches(nextMatches);
    await saveMatch(updated);
    setEditMatchId(null); setEditMatchForm(null);
  };

  const toggleRoster = async (playerId) => {
    const inRoster = session.roster.includes(playerId);
    const nextRoster = inRoster ? session.roster.filter((id) => id !== playerId) : [...session.roster, playerId];
    const next = { ...session, roster: nextRoster, balance: null };
    setSession(next);
    await saveSession(next);
  };
  const setPref = async (playerId, patch) => {
    const cur = (session.prefs || {})[playerId] || { team: "AUTO", roles: [] };
    const next = { ...session, prefs: { ...(session.prefs || {}), [playerId]: { ...cur, ...patch } }, balance: null };
    setSession(next);
    await saveSession(next);
  };
  // 複数選手のprefsを1回のsession更新で書き込む(対面指定など。連続setPrefのstale競合を防ぐ)
  const setPrefsBatch = async (patches) => { // patches: { [playerId]: patch }
    const nextPrefs = { ...(session.prefs || {}) };
    Object.entries(patches).forEach(([pid, patch]) => {
      const cur = nextPrefs[pid] || { team: "AUTO", roles: [] };
      nextPrefs[pid] = { ...cur, ...patch };
    });
    const next = { ...session, prefs: nextPrefs, balance: null };
    setSession(next);
    await saveSession(next);
  };
  const clearRoster = async () => {
    const next = { roster: [], prefs: {}, resetAt: session.resetAt || 0, balance: null };
    setSession(next);
    await saveSession(next);
  };

  const todayCounts = useMemo(() => {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const cutoff = Math.max(dayStart, session.resetAt || 0);
    const counts = {};
    matches.forEach((m) => {
      // 報告時点で加算(承認待ち含む)。却下/削除された試合はDB上に残らないため自動的に減算される
      if (m.timestamp < cutoff) return;
      m.entries.forEach((e) => { counts[e.playerId] = (counts[e.playerId] || 0) + 1; });
    });
    return counts;
  }, [matches, session.resetAt]);

  // 参加待機列: アクティブな選手を「本日の参加回数が少ない順」に並べたもの(①選手管理タブで常時表示・表示順は閲覧用)
  const activePlayersByQueue = useMemo(() => {
    return players.filter((p) => p.status !== "rest")
      .sort((a, b) => (todayCounts[a.id] || 0) - (todayCounts[b.id] || 0));
  }, [players, todayCounts]);

  // ハイライト対象(初期候補10人): 実際の自動選出(pickSeatsFairly)と同一ロジックで算出。
  // 参加回数が同数の場合は登録順ではなく希望ロールのカバレッジを優先するため、表示順(上記)とは一致しないことがある
  const initialSeatIds = useMemo(() => {
    const pool = players.filter((p) => p.status !== "rest");
    return new Set(pickSeatsFairly(pool, 10, todayCounts).map((p) => p.id));
  }, [players, todayCounts]);

  const resetTodayCount = async () => {
    if (!(await themedConfirm(t("shell.058")))) return;
    const next = { ...session, resetAt: Date.now() };
    setSession(next);
    await saveSession(next);
  };

  // 対面レート格差(しきい値以上)の一覧。ライブμ基準で常に再計算される。
  const matchupWarnings = useMemo(
    () => matchupGaps(balanceResult, players, matchupThreshold),
    [balanceResult, players, matchupThreshold]
  );
  const warnRoles = useMemo(() => new Set(matchupWarnings.map((w) => w.role)), [matchupWarnings]);

  // 編成確定直後に格差マッチアップを通知する。
  // prevRoles を渡した場合は「新たに増えたレーンがある場合のみ」表示する
  // (タップ入替のたびに毎回モーダルが出るのを防ぐため)。
  const notifyMatchupGaps = async (result, prevRoles = null) => {
    const gaps = matchupGaps(result, players, matchupThreshold);
    if (!gaps.length) return;
    if (prevRoles && gaps.every((g) => prevRoles.has(g.role))) return;
    const lines = gaps.map((g) => t("balance.074", {
      role: g.role, hi: g.hiName, lo: g.loName,
      hiMu: g.hiMu.toFixed(1), loMu: g.loMu.toFixed(1), diff: g.diff.toFixed(1),
    }));
    const names = gaps.flatMap((g) => [g.role, g.aName, g.bName]);
    await themedAlert([t("balance.075"), "", ...lines, "", t("balance.076")].join("\n"), names, { nowrap: true });
  };

  // 対面レート格差の警告しきい値を変更する(管理者PASS要・全端末共有)。
  const editMatchupThreshold = async () => {
    if (!(await requireAdminPass(t("balance.080")))) return;
    const v = await themedPrompt(t("balance.081", { min: MATCHUP_WARN_MIN, max: MATCHUP_WARN_MAX }), {
      defaultValue: String(matchupThreshold),
    });
    if (v === null) return; // キャンセル
    const n = Number(String(v).trim());
    if (!Number.isFinite(n) || n < MATCHUP_WARN_MIN || n > MATCHUP_WARN_MAX) {
      await themedAlert(t("balance.082", { min: MATCHUP_WARN_MIN, max: MATCHUP_WARN_MAX }));
      return;
    }
    const next = { ...settings, matchupWarnThreshold: clampMatchupWarn(n) };
    setSettings(next);
    await saveShared("settings", next);
  };

  // チームA/B配列から差分指標(diff/laneDiff/prefHits/ngHits)を再計算する共通処理。
  // タップ入替・選手交代の両方から呼ばれる。
  const recalcResult = (teamA, teamB) => {
    const sum = (arr) => arr.reduce((s, x) => s + x.mu, 0);
    const laneOf = (arr) => { const m = {}; arr.forEach((x) => { m[x.role] = x.mu; }); return m; };
    const laneA = laneOf(teamA), laneB = laneOf(teamB);
    const laneDiff = ROLES.reduce((s, r) => s + (laneA[r] != null && laneB[r] != null ? Math.abs(laneA[r] - laneB[r]) : 0), 0);
    const prefHits = [...teamA, ...teamB].filter((x) => x.wanted).length;
    const ngHits = [...teamA, ...teamB].filter((x) => x.isNg).length;
    return { teamA, teamB, diff: Math.abs(sum(teamA) - sum(teamB)), laneDiff, prefHits, ngHits, manual: true };
  };
  const buildSlot = (p, role) => ({
    id: p.id, name: p.name, role,
    mu: p.roles[role].mu,
    wanted: !!(p.prefRoles || []).includes(role),
    isNg: !!(p.ngRoles || []).includes(role),
  });

  // チーム分け結果のスロット(チーム×ロール)間で選手を入替える(手動微調整)。
  // ロールは各スロットに固定のまま、そこに座る選手だけが入れ替わる。
  const handleSlotTap = async (team, idx) => {
    if (!swapSel) { setSwapSel({ team, idx }); setSubPickerOpen(false); return; }
    if (swapSel.team === team && swapSel.idx === idx) { setSwapSel(null); setSubPickerOpen(false); return; }

    const teamA = [...balanceResult.teamA], teamB = [...balanceResult.teamB];
    const arrOf = (team) => (team === "A" ? teamA : teamB);
    const slotA = arrOf(swapSel.team)[swapSel.idx];
    const slotB = arrOf(team)[idx];
    const roleA = slotA.role, roleB = slotB.role;
    const pA = players.find((x) => x.id === slotA.id);
    const pB = players.find((x) => x.id === slotB.id);
    if (!pA || !pB) { setSwapSel(null); return; }

    // NGロールへの入替は絶対に許可しない(自動編成と同じ方針をタップ入替にも適用)
    const pAWouldBeNg = (pA.ngRoles || []).includes(roleB);
    const pBWouldBeNg = (pB.ngRoles || []).includes(roleA);
    if (pAWouldBeNg || pBWouldBeNg) {
      const ngName = pAWouldBeNg ? pA.name : pB.name;
      const ngRole = pAWouldBeNg ? roleB : roleA;
      themedAlert(t("shell.082", { name: ngName, role: ngRole }), [ngName, ngRole]);
      setSwapSel(null);
      return;
    }

    // 暴発防止の確認ダイアログ(NGブロック判定より後・実際の入替処理より前)
    if (!(await themedConfirm(t("shell.083", { name1: pA.name, role1: roleA, name2: pB.name, role2: roleB }), [pA.name, pB.name]))) {
      setSwapSel(null);
      return;
    }

    const prevRoles = new Set(matchupGaps(balanceResult, players, matchupThreshold).map((g) => g.role));

    arrOf(swapSel.team)[swapSel.idx] = buildSlot(pB, roleA);
    arrOf(team)[idx] = buildSlot(pA, roleB);

    const result = { ...balanceResult, ...recalcResult(teamA, teamB) };
    setBalanceResult(result);
    setSwapSel(null);
    const nextSession = { ...session, balance: result };
    setSession(nextSession);
    await saveSession(nextSession);
    await notifyMatchupGaps(result, prevRoles);
  };

  // 選手交代: 選択中のスロットに、現在チームに入っていない選手を投入する。
  // 交代元はチームから抜けるがrosterからは外さない(待機扱いに戻る)。
  const handleSubstitute = async (candidateId) => {
    if (!swapSel || !balanceResult) return;
    const teamA = [...balanceResult.teamA], teamB = [...balanceResult.teamB];
    const arrOf = (team) => (team === "A" ? teamA : teamB);
    const slot = arrOf(swapSel.team)[swapSel.idx];
    const role = slot.role;
    const outPlayer = players.find((x) => x.id === slot.id);
    const inPlayer = players.find((x) => x.id === candidateId);
    if (!inPlayer) return;

    if ((inPlayer.ngRoles || []).includes(role)) {
      themedAlert(t("shell.085", { name: inPlayer.name, role }), [inPlayer.name, role]);
      return;
    }
    if (!(await themedConfirm(t("shell.084", { out: outPlayer ? outPlayer.name : "-", in: inPlayer.name, role }), [outPlayer ? outPlayer.name : "", inPlayer.name, role]))) return;
    if (!(await requireAdminPass(t("balance.059")))) return;

    const prevRoles = new Set(matchupGaps(balanceResult, players, matchupThreshold).map((g) => g.role));

    arrOf(swapSel.team)[swapSel.idx] = buildSlot(inPlayer, role);
    const result = { ...balanceResult, ...recalcResult(teamA, teamB) };
    setBalanceResult(result);
    setSwapSel(null);
    setSubPickerOpen(false);
    const nextRoster = session.roster.includes(candidateId) ? session.roster : [...session.roster, candidateId];
    const nextSession = { ...session, roster: nextRoster, balance: result };
    setSession(nextSession);
    await saveSession(nextSession);
    await notifyMatchupGaps(result, prevRoles);
  };

  const runBalance = async () => {
    const chosen = seating.seatedIds
      .map((id) => players.find((p) => p.id === id))
      .filter(Boolean)
      .map((p) => {
        const pref = (session.prefs || {})[p.id] || { team: "AUTO" };
        return {
          id: p.id, name: p.name, roles: p.roles,
          lockedTeam: pref.team === "AUTO" ? null : pref.team,
          lockedRole: pref.role && pref.role !== "AUTO" ? pref.role : null,
          prefRoles: p.prefRoles || [], ngRoles: p.ngRoles || [],
        };
      });

    // 同一チーム内で同じレーンが複数人固定されていないか事前チェック(具体的なアラートを出すため)
    const seen = {}; // "A_TOP" -> playerName
    for (const c of chosen) {
      if (!c.lockedTeam || !c.lockedRole) continue;
      const key = `${c.lockedTeam}_${c.lockedRole}`;
      if (seen[key]) {
        themedAlert(t("balance.061", { team: sideLabel(c.lockedTeam), role: c.lockedRole }), [c.lockedRole]);
        return;
      }
      seen[key] = c.name;
    }

    const result = bestBalancedSplit(chosen);
    setBalanceResult(result);
    // 他端末でも同じ結果を確認できるよう共有sessionに保存(未実行に戻さないよう割当不能時はnullで明示クリア)
    const nextSession = { ...session, balance: result || null };
    setSession(nextSession);
    await saveSession(nextSession);
    await notifyMatchupGaps(result);
  };

  // 登録済み全メンバーから直接10人を自動選出してチーム編成まで一括実行。
  // 調整枠は「アクティブ不足時」に加え「レート差が大きい場合」にも入替投入される
  const AUTO_DIFF_THRESHOLD = 12; // このpt差を超えたら調整枠での改善を試みる
  const autoAssignAll = async () => {
    if (!(await requireAdminPass(t("balance.004")))) return;
    const pool = players.filter((p) => p.status !== "rest");
    if (pool.length < 2) { themedAlert(t("shell.059")); return; }

    const prefOf = (id) => (session.prefs || {})[id] || { team: "AUTO" };
    const isLocked = (p) => {
      const pref = prefOf(p.id);
      return pref.force !== "bench" && ((pref.team && pref.team !== "AUTO") || (pref.role && pref.role !== "AUTO"));
    };
    const lockedPlayers = pool.filter(isLocked);
    if (lockedPlayers.length > 10) { themedAlert(t("balance.062")); return; }

    // 同一チーム内で同じレーンが複数人固定されていないか事前チェック
    const seenLock = {};
    for (const p of lockedPlayers) {
      const pref = prefOf(p.id);
      if (!pref.team || pref.team === "AUTO" || !pref.role || pref.role === "AUTO") continue;
      const key = `${pref.team}_${pref.role}`;
      if (seenLock[key]) { themedAlert(t("balance.061", { team: sideLabel(pref.team), role: pref.role }), [pref.role]); return; }
      seenLock[key] = p.name;
    }

    const toChosen = (ps) => ps.map((p) => {
      const pref = prefOf(p.id);
      return {
        id: p.id, name: p.name, roles: p.roles,
        lockedTeam: pref.team && pref.team !== "AUTO" ? pref.team : null,
        lockedRole: pref.role && pref.role !== "AUTO" ? pref.role : null,
        prefRoles: p.prefRoles || [], ngRoles: p.ngRoles || [],
      };
    });

    const restPool = pool.filter((p) => !lockedPlayers.some((l) => l.id === p.id));
    let seated = [...lockedPlayers, ...pickSeatsFairly(restPool, 10 - lockedPlayers.length, todayCounts, lockedPlayers)];
    let result = bestBalancedSplit(toChosen(seated));

    // 選出した10人の組み合わせではNG制約等により割当不能な場合、
    // その10人に固執せず、参加回数の多い人から順に1人ずつ他の候補と入替えて再試行する。
    // (参加回数が少ない人を優先的に外す=不公平になるのを避けるため、多い人から外す。
    //  固定選手はチーム/レーン指定の意図を壊さないよう除外対象から外す)
    if (!result) {
      const notSeated = pool.filter((p) => !seated.some((s) => s.id === p.id));
      const outOrder = [...seated]
        .filter((p) => !lockedPlayers.some((l) => l.id === p.id))
        .sort((a, b) => (todayCounts[b.id] || 0) - (todayCounts[a.id] || 0));
      outer: for (const out of outOrder) {
        for (const cand of notSeated) {
          const trial = seated.map((s) => (s.id === out.id ? cand : s));
          const r = bestBalancedSplit(toChosen(trial));
          if (r) { seated = trial; result = r; break outer; }
        }
      }
      if (!result) {
        themedAlert(t("shell.060"));
        return;
      }
    }

    // レート差が閾値超なら、調整枠との入替で改善を反復探索
    // (NG違反数を悪化させる入替は採用しない。あくまでNG回避が最優先という設計を、
    //  この調整ループでも一貫させるため。固定選手は入替候補から除外)
    if (result) {
      let adjustBench = pool.filter((p) => p.adjust && !seated.some((s) => s.id === p.id));
      let guard = 0;
      while (result.diff > AUTO_DIFF_THRESHOLD && adjustBench.length && guard < 5) {
        guard++;
        // 外す候補: 出場中で参加回数が多い順に上位3人(公平性維持)、調整枠自身も外し候補
        const outCandidates = [...seated]
          .filter((p) => !lockedPlayers.some((l) => l.id === p.id))
          .sort((a, b) => (todayCounts[b.id] || 0) - (todayCounts[a.id] || 0))
          .slice(0, 3);
        let bestSwap = null;
        for (const out of outCandidates) {
          for (const inn of adjustBench) {
            const cand = seated.filter((s) => s.id !== out.id).concat(inn);
            const r2 = bestBalancedSplit(toChosen(cand));
            if (!r2) continue;
            if (r2.ngHits > result.ngHits) continue; // NG違反を悪化させる入替は候補から除外
            // 比較優先順位: ①NG違反数(少ない方) → ②レート差(小さい方)
            if (!bestSwap || r2.ngHits < bestSwap.r.ngHits || (r2.ngHits === bestSwap.r.ngHits && r2.diff < bestSwap.r.diff)) {
              bestSwap = { out, inn, r: r2, cand };
            }
          }
        }
        if (bestSwap && (bestSwap.r.ngHits < result.ngHits || bestSwap.r.diff < result.diff - 1)) {
          seated = bestSwap.cand;
          result = bestSwap.r;
          adjustBench = pool.filter((p) => p.adjust && !seated.some((s) => s.id === p.id));
        } else break;
      }
    }

    setBalanceResult(result);
    const nextSession = { ...session, roster: seated.map((p) => p.id), resetAt: session.resetAt || 0, balance: result || null };
    setSession(nextSession);
    await saveSession(nextSession);
    await notifyMatchupGaps(result);
  };
  // 段階①: 状態(アクティブ優先、調整枠は不足分のみ) → 参加回数(本日)が少ない順に自動選出
  const seating = useMemo(() => {
    const roster = session.roster.map((id) => players.find((p) => p.id === id)).filter(Boolean);
    const forceSeat = roster.filter((p) => (session.prefs || {})[p.id]?.force === "seat").map((p) => p.id);
    const forceBench = new Set(roster.filter((p) => (session.prefs || {})[p.id]?.force === "bench").map((p) => p.id));
    const free = roster.filter((p) => !forceSeat.includes(p.id) && !forceBench.has(p.id));
    const forceSeatPlayers = roster.filter((p) => forceSeat.includes(p.id));
    const remain = Math.max(0, 10 - forceSeat.length);
    const autoSeat = pickSeatsFairly(free, remain, todayCounts, forceSeatPlayers).map((p) => p.id);
    const seatedIds = [...forceSeat, ...autoSeat];
    const benchIds = roster.map((p) => p.id).filter((id) => !seatedIds.includes(id));
    return { seatedIds, benchIds, overflow: forceSeat.length > 10 };
  }, [session, players, todayCounts]);
  const filledCount = seating.seatedIds.length;

  const leaderboard = useMemo(() => {
    const rated = players.map((p) => {
      const role = boardRole === "MAIN" ? mainRoleOf(p) : boardRole;
      const r = p.roles[role];
      const roleGames = p.kdaHistory.filter((h) => h.role === role);
      const roleWins = roleGames.filter((h) => h.won).length;
      const roleLosses = roleGames.length - roleWins;
      return {
        ...p, _mu: r.mu, _sigma: r.sigma, _role: role,
        _wins: roleWins, _losses: roleLosses, _prov: roleGames.length < 3,
      };
    });
    const bySkill = (a, b) => conservative(b._mu, b._sigma) - conservative(a._mu, a._sigma);
    return [...rated.filter((x) => !x._prov).sort(bySkill), ...rated.filter((x) => x._prov).sort(bySkill)];
  }, [players, boardRole]);

  // 前回開催日終了時点の順位(順位変動表示用)。承認済み試合を開催日単位で分割し、
  // 最新開催日より前の試合のみでrecomputeAllした順位を比較基準にする。
  const prevRankMap = useMemo(() => {
    const approved = matches.filter((m) => m.status === "approved");
    if (approved.length === 0) return new Map();
    const dayOf = (ts) => {
      const d = new Date(ts);
      return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    };
    const latestDay = Math.max(...approved.map((m) => dayOf(m.timestamp)));
    const prevMatches = approved.filter((m) => dayOf(m.timestamp) < latestDay);
    if (prevMatches.length === 0) return new Map();
    const prevPlayers = recomputeAll(players, prevMatches);
    const rated = prevPlayers.map((p) => {
      const role = boardRole === "MAIN" ? mainRoleOf(p) : boardRole;
      const r = p.roles[role];
      const roleGames = p.kdaHistory.filter((h) => h.role === role);
      return { id: p.id, _mu: r.mu, _sigma: r.sigma, _prov: roleGames.length < 3 };
    });
    const bySkill = (a, b) => conservative(b._mu, b._sigma) - conservative(a._mu, a._sigma);
    const ranked = [...rated.filter((x) => !x._prov).sort(bySkill), ...rated.filter((x) => x._prov).sort(bySkill)];
    const map = new Map();
    ranked.forEach((p, i) => { if (!p._prov) map.set(p.id, i + 1); });
    return map;
  }, [players, matches, boardRole]);


  const pendingMatches = matches.filter((m) => m.status === "pending").sort((a, b) => a.timestamp - b.timestamp);

  const approvedMatches = matches.filter((m) => m.status === "approved");

  const chartData = useMemo(() => {
    const p = players.find((x) => x.id === chartPlayerId);
    if (!p) return [];
    const prof = p.roles[chartRole]?.prof || "△";
    const points = [{ idx: 0, mu: Math.round(effectiveBaseMu(p) * PROF_RATE[prof] * 10) / 10 }];
    p.kdaHistory.filter((h) => h.role === chartRole).forEach((h, i) =>
      points.push({ idx: i + 1, mu: Math.round(h.mu * 10) / 10 }));
    return points;
  }, [players, chartPlayerId, chartRole]);

  const nameOf = (id) => players.find((p) => p.id === id)?.name || "?";

  // 履歴タブ(個別/全体)で共有する試合1行分の描画。readOnly時は編集/削除アイコンを非表示
  const renderMatchRow = (m, { readOnly }) => (
    <React.Fragment key={m.id}>
      <tr style={{ cursor: "pointer" }} onClick={() => setExpandedMatch(expandedMatch === m.id ? null : m.id)}>
        <td style={{ color: theme.accent, fontWeight: 700 }}>{expandedMatch === m.id ? "▼" : "▶"}</td>
        <td style={{ color: theme.textSub }}>{new Date(m.timestamp).toLocaleString(dateLocale())}</td>
        <td>{m.entries.filter((e) => e.team === "A").map((e) => `${nameOf(e.playerId)}(${e.role})`).join(", ")}</td>
        <td>{m.entries.filter((e) => e.team === "B").map((e) => `${nameOf(e.playerId)}(${e.role})`).join(", ")}</td>
        <td style={{ color: m.winner === "A" ? theme.accentBright : theme.teamB, fontWeight: 700 }}>{sideLabel(m.winner)}</td>
        <td style={{ display: "flex", gap: 8 }}>
          {!readOnly && (
            <>
              <Pencil size={16} style={{ cursor: "pointer", color: theme.accent }} onClick={(ev) => { ev.stopPropagation(); editMatchId === m.id ? setEditMatchId(null) : startEditMatch(m); setExpandedMatch(m.id); }} />
              <Trash2 size={16} style={{ cursor: "pointer", color: theme.textFaint }} onClick={(ev) => { ev.stopPropagation(); deleteMatch(m.id); }} />
            </>
          )}
        </td>
      </tr>
      {expandedMatch === m.id && (
        <tr>
          <td colSpan={6} style={{ background: theme.surfaceAlt, padding: "12px 14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1px 1fr", gap: 20 }}>
              {["A", "B"].map((side, ti) => (
                <React.Fragment key={side}>
                  {ti === 1 && <div style={{ background: theme.border }} />}
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: side === "A" ? theme.accentBright : theme.teamB, marginBottom: 6 }}>
                      {sideLabel(side)}{m.winner === side && " 🏆"}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "30px minmax(80px,150px) minmax(0,1fr) 92px 68px", gap: 0, fontSize: 12, color: theme.textFaint, borderBottom: `1px solid ${theme.border}`, paddingBottom: 4, marginBottom: 2 }}>
                      <span></span>
                      <span style={{ borderLeft: `1px solid ${theme.borderTable}`, paddingLeft: 8 }}>{t("shell.028")}</span>
                      <span>{t("shell.061")}</span>
                      <span style={{ textAlign: "center", borderLeft: `1px solid ${theme.borderTable}`, paddingLeft: 8 }}>KDA</span>
                      <span style={{ textAlign: "right", borderLeft: `1px solid ${theme.borderTable}`, paddingLeft: 8, whiteSpace: "nowrap" }}>{t("shell.062")}</span>
                    </div>
                    {m.entries.filter((e) => e.team === side).map((e) => {
                      const kda = (m.kda || {})[e.playerId] || {};
                      const p = players.find((x) => x.id === e.playerId);
                      const hist = p?.kdaHistory.find((h) => h.matchId === m.id && h.role === e.role);
                      return (
                        <div key={e.playerId} style={{ display: "grid", gridTemplateColumns: "30px minmax(80px,150px) minmax(0,1fr) 92px 68px", gap: 0, alignItems: "center", fontSize: 14, padding: "5px 0", borderBottom: `1px solid ${theme.borderTable}` }}>
                          <span style={{ color: theme.textFaint, fontSize: 13 }}>{e.role}</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderLeft: `1px solid ${theme.borderTable}`, paddingLeft: 8, paddingRight: 6 }} title={nameOf(e.playerId)}>{nameOf(e.playerId)}</span>
                          <span style={{ display: "flex", alignItems: "center", gap: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, color: theme.textSub }}>
                            {e.champion ? <ChampIcon name={e.champion} size={16} /> : null}{champLabel(e.champion) || "-"}
                          </span>
                          <span style={{
                            display: "grid", gridTemplateColumns: "1fr auto 1fr auto 1fr",
                            color: theme.textSub, borderLeft: `1px solid ${theme.borderTable}`, paddingLeft: 8,
                            fontVariantNumeric: "tabular-nums",
                          }}>
                            {kda.k != null ? (
                              <>
                                <span style={{ textAlign: "right" }}>{kda.k}</span>
                                <span style={{ textAlign: "center", padding: "0 2px", color: theme.textFaint }}>/</span>
                                <span style={{ textAlign: "right" }}>{kda.d}</span>
                                <span style={{ textAlign: "center", padding: "0 2px", color: theme.textFaint }}>/</span>
                                <span style={{ textAlign: "right" }}>{kda.a}</span>
                              </>
                            ) : <span style={{ gridColumn: "1 / -1", textAlign: "center", color: theme.textFaint }}>-</span>}
                          </span>
                          <span style={{ textAlign: "right", fontWeight: 700, borderLeft: `1px solid ${theme.borderTable}`, paddingLeft: 8, color: hist == null ? theme.textFaint : hist.delta > 0 ? theme.accentBright : theme.teamB }}>
                            {hist ? `${hist.delta > 0 ? "+" : ""}${hist.delta.toFixed(1)}` : "-"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </React.Fragment>
              ))}
            </div>
            {!readOnly && editMatchId === m.id && editMatchForm && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${theme.border}` }}>
                <MatchEditForm form={editMatchForm} players={players}
                  setEntryField={setEditEntryField} setKda={setEditKda} setEntryPlayer={setEntryPlayer}
                  setWinner={(w) => setEditMatchForm({ ...editMatchForm, winner: w })}
                  error={editMatchError} onSave={saveMatchEdit} onCancel={() => setEditMatchId(null)}
                  champList={ddChamps ? ddChamps.map((x) => x.name) : CHAMPIONS} customChamps={customChamps} />
                <div style={{ fontSize: 13, color: theme.teamB, marginTop: 6 }}>
                  {t("shell.063")}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </React.Fragment>
  );

  const sortedPlayersForList = useMemo(() => {
    let arr = [...players];
    if (playerFilter === "active") arr = arr.filter((p) => p.status !== "rest" && !p.adjust);
    else if (playerFilter === "rest") arr = arr.filter((p) => p.status === "rest");
    else if (playerFilter === "adjust") arr = arr.filter((p) => p.adjust);
    else if (playerFilter === "noResponse") arr = arr.filter(isStaleResponse);
    // 休み/調整枠のON・OFFで並び順が変わるとカードが移動して操作しづらいため、
    // 状態(statusRank)は並び替えに使わない。選択中のソート基準のみで決まる固定順。
    if (playerSort === "name") return arr.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    if (playerSort === "rate_desc") return arr.sort((a, b) => repRating(b).mu - repRating(a).mu);
    if (playerSort === "rate_asc") return arr.sort((a, b) => repRating(a).mu - repRating(b).mu);
    if (playerSort.startsWith("role_")) {
      const r = playerSort.slice(5);
      return arr.sort((a, b) => b.roles[r].mu - a.roles[r].mu);
    }
    return arr;
  }, [players, playerSort, playerFilter]);

  const champImgMap = useMemo(() => {
    const m = {};
    (ddChamps || []).forEach((x) => { m[x.name] = x.img; });
    return m;
  }, [ddChamps]);
  const ChampIcon = ({ name, size = 22 }) => {
    if (!name || !ddVer || !champImgMap[name]) return null;
    return (
      <img src={`https://ddragon.leagueoflegends.com/cdn/${ddVer}/img/champion/${champImgMap[name]}`}
        alt="" width={size} height={size}
        style={{ borderRadius: 4, verticalAlign: "middle", marginRight: 5, border: `1px solid ${theme.border}` }} />
    );
  };

  if (!getDb()) {
    return (
      <div style={{ fontFamily: "var(--cs-font)", maxWidth: 720, margin: "40px auto", padding: 24, background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.text, lineHeight: 1.7 }}>
        <h2 style={{ color: theme.accent }}>{t("shell.064")}</h2>
        <p>{t("shell.065")} <b>FIREBASE_CONFIG</b> {t("shell.066")}</p>
        <p style={{ fontSize: 14, color: theme.textSub }}>{t("shell.067")}</p>
      </div>
    );
  }

  if (VIEW_PASS && !gateOk) {
    return (
      <div style={{ fontFamily: "var(--cs-font)", maxWidth: 420, margin: "80px auto", padding: 28, background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.text, textAlign: "center" }}>
        <h2 style={{ color: theme.accent, marginTop: 0 }}>CUSTOM RIFT LEDGER</h2>
        <p style={{ fontSize: 15 }}>{t("shell.068")}</p>
        <input type="password" value={gateInput} onChange={(e) => setGateInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && gateInput === VIEW_PASS) { localStorage.setItem("crl-gate", VIEW_PASS); setGateOk(true); } }}
          style={{ padding: "10px 12px", fontSize: 16, border: `1px solid ${theme.borderInput}`, borderRadius: 6, width: 200, textAlign: "center" }} />
        <div style={{ marginTop: 12 }}>
          <button onClick={() => { if (gateInput === VIEW_PASS) { localStorage.setItem("crl-gate", VIEW_PASS); setGateOk(true); } }}
            style={{ background: "linear-gradient(135deg,var(--cs-headFrom),var(--cs-headTo))", color: "#FFFFFF", border: "none", borderRadius: 6, padding: "10px 28px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            {t("shell.069")}
          </button>
        </div>
      </div>
    );
  }

  if (dbError) {
    return (
      <div style={{ fontFamily: "var(--cs-font)", maxWidth: 720, margin: "40px auto", padding: 24, background: theme.surface, border: `1px solid ${theme.teamB}`, borderRadius: 10, color: theme.text, lineHeight: 1.7 }}>
        <h2 style={{ color: theme.teamB }}>{t("shell.070")}</h2>
        <p>{dbError}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: theme.textSub }}>
        <Loader2 className="spin" size={22} style={{ marginRight: 8 }} /> {t("shell.071")}
      </div>
    );
  }

  return (
    <div style={{
      fontFamily: "var(--cs-font)",
      background: theme.bgVia,
      color: theme.text, fontWeight: 400, minHeight: "60vh", borderRadius: 10, padding: "20px 22px 28px",
      border: `1px solid ${theme.border}`,
    }}>
      {dialog && (
        <div onClick={() => { if (dialog.type === "alert") closeDialog(undefined); }}
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ ...cardStyle, background: theme.surface, width: "min(720px, 94vw)", padding: "26px 26px 20px", boxShadow: "0 8px 40px rgba(0,0,0,.4)", borderColor: dialog.type === "alert" ? theme.teamB : theme.accent, borderWidth: 2 }}>
            <div className="cs-prose" style={{ fontSize: 15, fontWeight: 700, color: theme.text, lineHeight: 1.7, marginBottom: 16, whiteSpace: dialog.nowrap ? "pre" : "pre-wrap", overflowX: "auto" }}>
              {dialog.content}
            </div>
            {dialog.type === "prompt" && (
              <input className="cs-input" autoFocus type={dialog.password ? "password" : "text"} value={dialogInput}
                onChange={(e) => setDialogInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") closeDialog(dialogInput); }}
                style={{ width: "100%", fontSize: 16, padding: "9px 12px", marginBottom: 16, boxSizing: "border-box" }} />
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              {(dialog.type === "confirm" || dialog.type === "prompt") && (
                <button className="cs-btn-ghost" style={{ padding: "9px 22px", fontSize: 15 }}
                  onClick={() => closeDialog(dialog.type === "confirm" ? false : null)}>{t("players.044")}</button>
              )}
              <button className="cs-btn" style={{ padding: "9px 26px", fontSize: 15 }}
                onClick={() => closeDialog(dialog.type === "alert" ? undefined : dialog.type === "confirm" ? true : dialogInput)}>OK</button>
            </div>
          </div>
        </div>
      )}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&family=Zen+Maru+Gothic:wght@400;700&family=Zen+Old+Mincho:wght@400;700&family=Yuji+Syuku&family=Zen+Kurenaido&family=Klee+One:wght@400;600&display=swap');
        :root {
          /* JSでのテーマ適用(applyTheme)前でも正しく表示されるデフォルト値(sky+ゴシック体) */
          --cs-bgFrom:#F4F8FB; --cs-bgVia:#E9F1F7; --cs-bgTo:#DCE8F0;
          --cs-text:#1B3A56; --cs-textSub:#5B7C99; --cs-textFaint:#8FADC7;
          --cs-surface:#FFFFFF; --cs-surfaceAlt:#F4F9FD; --cs-surfaceWhite:#FDFEFF;
          --cs-border:#C3DCEA; --cs-borderInput:#B0D2E5; --cs-borderTable:#DCEBF3;
          --cs-accent:#0F5FA3; --cs-accentBright:#2483C9; --cs-accentDeep:#0D4A80;
          --cs-teamB:#C94F14; --cs-faintAccent:#B7CEE0; --cs-faintAccent2:#A9C1DA;
          --cs-profGreat:#8A3FA0; --cs-profGood:#2483C9; --cs-profFair:#C99A1E; --cs-profWeak:#9AA3AD;
          --cs-headFrom:#1E78BC; --cs-headTo:#0F5FA3; --cs-headBFrom:#C94F14; --cs-headBTo:#9E3C0D; --cs-badgeBg:transparent;
          --cs-font:'Noto Sans JP','Hiragino Kaku Gothic ProN','Yu Gothic','Meiryo',sans-serif;
        }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 640px) { .cs-hide-mobile { display: none; } }
        .cs-scroll::-webkit-scrollbar { height: 5px; width: 5px; }
        .cs-scroll::-webkit-scrollbar-thumb { background: ${theme.borderInput}; border-radius: 3px; }
        .cs-input { background:${theme.surfaceWhite}; border:1px solid ${theme.borderInput}; color:${theme.text}; border-radius:6px; padding:8px 10px; font-size:16.5px; font-family:var(--cs-font); }
        .cs-input:focus { outline: 1px solid ${theme.accentBright}; }
        .cs-btn { background:linear-gradient(135deg,var(--cs-headFrom),var(--cs-headTo)); color:#FFFFFF; border:none; border-radius:6px; padding:9px 16px; font-weight:700; font-size:16.5px; cursor:pointer; }
        .cs-btn:disabled { opacity:.4; cursor:not-allowed; }
        .cs-btn-ghost { background:transparent; border:1px solid ${theme.borderInput}; color:${theme.text}; border-radius:6px; padding:9px 16px; font-size:16.5px; cursor:pointer; }
        table.cs-table { width:100%; border-collapse:separate; border-spacing:0; font-size:16.5px; border-radius:8px; overflow:hidden; }
        table.cs-table th { text-align:center; background:linear-gradient(135deg,var(--cs-headFrom),var(--cs-headTo)); color:#FFFFFF; font-weight:700; font-size:14.5px; padding:9px 10px; border-bottom:none; }
        table.cs-table td { padding:10px; border-bottom:1px solid ${theme.borderTable}; text-align:center; background:${theme.surface}; line-height:1.4; }
        table.cs-table tbody tr:nth-child(even) td { background:${theme.surfaceAlt}; }
        .cs-cols2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
        .cs-cols2-wide { display:grid; grid-template-columns:1fr 1fr; gap:20px; align-items:start; }
        .cs-side-narrow { display:grid; grid-template-columns:minmax(280px,440px) 1fr; gap:20px; align-items:start; }
        .cs-reprow { display:grid; grid-template-columns:86px 1fr 1fr 44px 44px 44px 20px; gap:5px; align-items:center; }
        .cs-reprow6 { display:grid; grid-template-columns:70px 1fr 1fr 46px 46px 46px; gap:6px; align-items:center; }
        .cs-reg-split { display:grid; grid-template-columns:150px minmax(0,1fr); gap:16px; }
        .cs-reg-roles { display:grid; grid-template-columns:repeat(5, minmax(0,1fr)); gap:6px; }
        @media (max-width: 760px) {
          .cs-cols2, .cs-cols2-wide, .cs-side-narrow { grid-template-columns:1fr; }
          .cs-reprow { grid-template-columns:64px 1fr 1fr 36px 36px 36px 16px; gap:3px; }
          .cs-reprow6 { grid-template-columns:54px 1fr 1fr 34px 34px 34px; gap:3px; }
          table.cs-table th, table.cs-table td { padding:7px 5px; font-size:14px; }
          .cs-reg-split { grid-template-columns:1fr; }
          .cs-reg-roles { grid-template-columns:repeat(3, minmax(0,1fr)); }
        }

        /* フォーム部品はOS既定フォントに落ちるので明示的に継承させる */
        #root button, #root select, #root input, #root textarea, #root optgroup {
          font-family: var(--cs-font);
          font-size: inherit;
        }

        /* 数字を等幅に（教科書体では効かなかった。ゴシックなら効く） */
        #root, table.cs-table th, table.cs-table td {
          font-feature-settings: "palt" 1;   /* 日本語の詰め */
        }
        table.cs-table th, table.cs-table td,
        .cs-num { font-variant-numeric: tabular-nums; }

        /* --- 折らない。幅が足りなければ横スクロール --- */
        table.cs-table th, table.cs-table td,
        #root button, #root select, #root label,
        .cs-nowrap { white-space: nowrap; }

        /* 長さが読めないものは1行＋… */
        .cs-ellipsis {
          overflow: hidden; text-overflow: ellipsis;
          white-space: nowrap; min-width: 0;
        }

        /* 折る必然があるのは長文だけ */
        .cs-prose {
          word-break: auto-phrase;   /* Chrome 119+ */
          word-break: keep-all;      /* フォールバック。韓国語でも文節相当になる */
          overflow-wrap: anywhere;   /* 長いURLだけはどこでも折る */
          text-wrap: pretty;
        }
        /* 上の2行はこの順序が必須。auto-phrase 非対応だと後行が勝つ */

        /* grid/flex の子を縮むようにする(列幅崩れ・横溢れの修正) */
        #root [style*="grid"] > *, #root [style*="flex"] > * { min-width: 0; }

        /* 横スクロールできることを見せる */
        .cs-scroll {
          overflow-x: auto;
          scrollbar-width: thin;
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <h1 style={{
          fontFamily: "var(--cs-font)", fontSize: 34, fontWeight: 700, margin: 0,
          color: theme.text,
          letterSpacing: "0.02em",
        }}>
          CUSTOM RIFT LEDGER
        </h1>
        <span style={{ fontSize: 15, color: theme.textSub }}>{t("header.001")}</span>
        <span style={{ marginLeft: "auto", fontSize: 13, color: theme.textSub, border: `1px solid ${theme.borderInput}`, borderRadius: 6, padding: "4px 12px" }}>
          {t("header.002")} {ddVer ? t("header.024", { ver: ddVer }) : t("header.003")}
        </span>
        <span style={{ position: "relative" }}>
          <button className="cs-btn-ghost" title={t("header.004")} style={{ padding: "6px 10px" }}
            onClick={() => setThemePickerOpen(!themePickerOpen)}>
            <Palette size={16} />
          </button>
          {themePickerOpen && (
            <div style={{ ...cardStyle, position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 20, width: 220, padding: 14 }}>
              <div style={{ fontSize: 13, color: theme.textSub, marginBottom: 10 }}>{t("header.005")}</div>
              <label style={{ fontSize: 13, color: theme.textSub, display: "block", marginBottom: 3 }}>{t("header.006")}</label>
              <select className="cs-input" style={{ width: "100%", marginBottom: 10 }} value={colorKey} onChange={(e) => setColorKey(e.target.value)}>
                {THEME_LIST.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <label style={{ fontSize: 13, color: theme.textSub, display: "block", marginBottom: 3 }}>{t("header.007")}</label>
              <select className="cs-input" style={{ width: "100%" }} value={fontKey} onChange={(e) => setFontKey(e.target.value)}>
                {FONT_LIST.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <label style={{ fontSize: 13, color: theme.textSub, display: "block", marginTop: 10, marginBottom: 3 }}>Language / 言語 / 언어</label>
              <div style={{ display: "flex", gap: 6 }}>
                {[["ja", "日本語"], ["en", "English"], ["ko", "한국어"]].map(([code, label]) => (
                  <button key={code} className={lang === code ? "cs-btn" : "cs-btn-ghost"}
                    style={{ flex: 1, padding: "5px 0", fontSize: 13 }}
                    onClick={() => setLangState(code)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </span>
      </div>
      <p style={{ fontSize: 15, color: theme.textFaint, marginTop: 0, marginBottom: 16 }}>
        {t("header.008")}
      </p>

      {(() => {
        const GROUPS = [
          { key: "register", label: t("header.030"), icon: UserPlus, tabs: [
            { id: "playerRegister", icon: UserPlus, label: t("header.029") },
            { id: "playerData", icon: RefreshCw, label: t("header.031") },
          ] },
          { key: "players", label: t("header.009"), icon: Users, tabs: [
            { id: "attendance", icon: CheckCircle2, label: t("header.027") },
            { id: "playerList", icon: Users, label: t("header.028") },
            { id: "queue", icon: ListOrdered, label: t("header.011") },
            { id: "playerRequests", icon: Pencil, label: t("header.025"), badge: rankRequests.length },
          ] },
          { key: "matching", label: t("header.012"), icon: Scale, tabs: [
            { id: "balance", icon: Scale, label: t("header.013") },
          ] },
          { key: "scouting", label: t("header.014"), icon: UserRound, tabs: [
            { id: "scoutStats", icon: UserRound, label: t("header.015") },
            { id: "scoutMulti", icon: Users, label: t("header.016") },
          ] },
          { key: "result", label: t("header.017"), icon: Swords, tabs: [
            { id: "report", icon: Swords, label: t("header.018") },
            { id: "pending", icon: CheckCircle2, label: t("header.026"), badge: pendingMatches.length },
            { id: "historyPlayer", icon: History, label: t("header.019") },
            { id: "historyAll", icon: History, label: t("header.020") },
          ] },
          { key: "database", label: t("header.021"), icon: Trophy, tabs: [
            { id: "board", icon: Trophy, label: t("header.022") },
            { id: "stats", icon: UserRound, label: t("header.023") },
            { id: "records", icon: Medal, label: t("shell.014") },
            { id: "rateTable", icon: ListOrdered, label: t("board.014") },
            { id: "itemEfficiency", icon: Coins, label: t("items.001") },
          ] },
        ];
        GROUPS.forEach((g) => { g.badge = g.tabs.reduce((sum, x) => sum + (x.badge || 0), 0); });
        const curGroup = GROUPS.find((g) => g.tabs.some((x) => x.id === tab)) || GROUPS[0];
        return (
          <>
            <div style={{ ...cardStyle, padding: "12px 14px 10px", marginBottom: 18 }}>
            <div className="cs-scroll" style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 10 }}>
              {GROUPS.map((g) => {
                const on = curGroup.key === g.key;
                return (
                <button key={g.key} onClick={() => setTab(g.tabs[0].id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 8,
                    border: `1px solid ${on ? "transparent" : theme.borderTable}`,
                    background: on ? "linear-gradient(135deg, var(--cs-headFrom), var(--cs-headTo))" : theme.surfaceAlt,
                    color: on ? "#FFFFFF" : theme.textSub,
                    fontWeight: on ? 700 : 500, fontSize: 15, fontFamily: "inherit",
                    cursor: "pointer", whiteSpace: "nowrap",
                  }}>
                  <g.icon size={16} /> {g.label} <Badge count={g.badge} />
                </button>
              );})}
            </div>
            <div className="cs-scroll" style={{ display: "flex", gap: 4, overflowX: "auto", borderTop: `1px solid ${theme.borderTable}`, paddingTop: 10 }}>
              {curGroup.tabs.map((tb) => (
                <TabButton key={tb.id} active={tab === tb.id} onClick={() => setTab(tb.id)} icon={tb.icon} label={tb.label} badge={tb.badge} />
              ))}
            </div>
            </div>
          </>
        );
      })()}

      {/* ---------- LEADERBOARD ---------- */}
      {tab === "board" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {["MAIN", ...ROLES].map((r) => (
              <button key={r} className="cs-btn-ghost"
                style={{ padding: "5px 12px", fontSize: 15.5, borderColor: boardRole === r ? theme.accent : theme.borderInput, color: boardRole === r ? theme.accent : theme.textSub, fontWeight: boardRole === r ? 700 : 400 }}
                onClick={() => setBoardRole(r)}>
                {r === "MAIN" ? t("board.001") : r}
              </button>
            ))}
          </div>
          {leaderboard.length === 0 ? (
            <EmptyState text={t("board.002")} />
          ) : (
            <table className="cs-table">
              <thead>
                <tr><th>#</th><th>{t("shell.028")}</th><th>{t("shell.030")}</th><th>{t("board.003")}</th><th>{t("board.004")}</th><th>{t("board.005")}</th><th>{t("board.006")}</th><th>{t("board.007")}</th><th>KD/A</th><th>{t("board.008")}</th></tr>
              </thead>
              <tbody>
                {leaderboard.map((p, i) => {
                  const total = p._wins + p._losses;
                  const wr = total ? Math.round((p._wins / total) * 100) : 0;
                  const roleHistory = p.kdaHistory.filter((h) => h.role === p._role);
                  const kdaGames = roleHistory.filter((h) => h.k != null);
                  const avgK = kdaGames.length ? (kdaGames.reduce((s, h) => s + h.k, 0) / kdaGames.length) : null;
                  const avgD = kdaGames.length ? (kdaGames.reduce((s, h) => s + h.d, 0) / kdaGames.length) : null;
                  const avgA = kdaGames.length ? (kdaGames.reduce((s, h) => s + h.a, 0) / kdaGames.length) : null;
                  const kdRatio = kdaGames.length
                    ? ((kdaGames.reduce((s, h) => s + h.k + h.a, 0)) / Math.max(kdaGames.reduce((s, h) => s + h.d, 0), 1)).toFixed(2)
                    : null;
                  const curRank = i + 1;
                  const prevRank = prevRankMap.get(p.id);
                  let rankChange = null;
                  if (!p._prov) {
                    if (prevRank == null) {
                      rankChange = <span style={{ fontSize: 12, color: theme.accent, fontWeight: 700, whiteSpace: "nowrap" }}>NEW</span>;
                    } else if (prevRank > curRank) {
                      rankChange = <span style={{ fontSize: 12, color: "#2E7D32", fontWeight: 700, whiteSpace: "nowrap" }}>▲{prevRank - curRank}</span>;
                    } else if (prevRank < curRank) {
                      rankChange = <span style={{ fontSize: 12, color: theme.teamB, fontWeight: 700, whiteSpace: "nowrap" }}>▼{curRank - prevRank}</span>;
                    } else {
                      rankChange = <span style={{ fontSize: 12, color: theme.textFaint, whiteSpace: "nowrap" }}>−</span>;
                    }
                  }
                  return (
                    <tr key={p.id} style={p._prov ? { opacity: 0.5 } : undefined}>
                      <td style={{ color: i < 3 && !p._prov ? theme.accent : theme.textSub, fontWeight: 700 }}>
                        {p._prov ? "-" : curRank}
                        {rankChange && <div>{rankChange}</div>}
                      </td>
                      <td style={{ maxWidth: 200 }}><span style={{ fontWeight: 700, fontSize: 17, display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }} title={p.name}>{p.name}</span>{p.honorRank && <span title={t("players.072", { honor: rankLabel(p.honorRank), rank: rankLabel(p.rank || "アンランク") })} style={{ fontSize: 11.5, fontWeight: 700, color: theme.accent, border: `1px solid ${theme.accentBright}`, borderRadius: 4, padding: "1px 5px", marginLeft: 6, whiteSpace: "nowrap", flexShrink: 0 }}>↑{rankShortLang(p.honorRank)}</span>}{p._prov && <span style={{ fontSize: 13, color: theme.textFaint, fontWeight: 400 }}>{t("board.009")}</span>}</td>
                      <td style={{ fontWeight: 700 }}>{p._role}</td>
                      <td><ProfBadge prof={p.roles[p._role].prof} /></td>
                      <td style={{ fontSize: 19, fontWeight: 700 }}>
                        {p._mu.toFixed(1)}
                      </td>
                      <td style={{ color: theme.textSub }}>{p._wins}{t("board.010")}{p._losses}{t("board.011")}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 60, height: 5, background: theme.borderTable, borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ width: `${wr}%`, height: "100%", background: wr >= 50 ? theme.accentBright : theme.teamB }} />
                          </div>
                          <span style={{ fontSize: 15.5, color: theme.textSub }}>{wr}%</span>
                        </div>
                      </td>
                      <td style={{ color: theme.textSub, fontSize: 15, whiteSpace: "nowrap" }}>
                        {avgK != null ? `${avgK.toFixed(1)} / ${avgD.toFixed(1)} / ${avgA.toFixed(1)}` : "-"}
                      </td>
                      <td style={{ fontWeight: 700, color: kdRatio != null && kdRatio >= 3 ? theme.accentBright : theme.textSub }}>
                        {kdRatio != null ? kdRatio : "-"}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          {roleHistory.slice(-5).reverse().map((h, j) => (
                            <img key={j} src={h.won ? WIN_BADGE_IMG : LOSE_BADGE_IMG} alt={h.won ? t("shell.034") : t("shell.035")} title={h.won ? t("shell.034") : t("shell.035")}
                              style={{ width: 22, height: 22, objectFit: "contain", background: "var(--cs-badgeBg)", borderRadius: 4 }} />
                          ))}
                          {roleHistory.length === 0 && <span style={{ fontSize: 13, color: theme.faintAccent }}>-</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ---------- REPORT ---------- */}
      {tab === "report" && (
        <div>
          {players.length < 2 ? (
            <EmptyState text={t("report.001")} />
          ) : (
            <>
              <datalist id="champList">
                {[...(ddChamps ? ddChamps.map((x) => x.name) : CHAMPIONS), ...customChamps].map((ch) => <option key={ch} value={champLabel(ch)} />)}
              </datalist>
              <div style={{ fontSize: 13, color: theme.textFaint, marginBottom: 10 }}>
                {t("report.002")}
              </div>

              {/* ---- スクショ読み取り(OCR) ---- */}
              <div style={{ ...cardStyle, marginBottom: 16, borderColor: theme.accent }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 240px" }}>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 3 }}>{t("report.003")}</div>
                    <div style={{ fontSize: 13, color: theme.textSub }}>
                      {teamOf("A").length === 5 && teamOf("B").length === 5
                        ? t("report.004")
                        : t("report.039")}
                    </div>
                  </div>
                  {teamOf("A").length === 5 && teamOf("B").length === 5 && (
                    <label className="cs-btn" style={{ cursor: "pointer" }}>
                      {t("report.006")}
                      <input type="file" accept="image/*" style={{ display: "none" }}
                        onChange={(e) => { if (e.target.files?.[0]) runOcrDirect(e.target.files[0]); e.target.value = ""; }} />
                    </label>
                  )}
                </div>
                {ocrBusy && <div style={{ marginTop: 8, fontSize: 14, color: theme.accent, fontWeight: 700 }}>{ocrBusy}</div>}

                {ocrRows && (
                  <div style={{ marginTop: 12, display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 380px", minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{t("report.008")}</span>
                      <span style={{ fontSize: 13, color: theme.textFaint }}>{t("report.013")}</span>
                    </div>

                                          <>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {ocrRows.map((r, i) => (
                            <div key={i} onClick={() => setOcrActiveRow(i)} style={{
                              display: "grid", gridTemplateColumns: "36px 60px 60px 60px minmax(0,1fr)", gap: 6, alignItems: "center", fontSize: 14,
                              background: r.teamNo === 1 ? "rgba(217,143,50,0.06)" : "rgba(156,59,46,0.06)",
                              padding: "5px 8px", borderRadius: 5, cursor: "pointer",
                              outline: ocrActiveRow === i ? `2px solid ${theme.accent}` : "none",
                            }}>
                              <span style={{ color: r.teamNo === 1 ? theme.accentBright : theme.teamB, fontWeight: 700, fontSize: 12 }}>{t("report.038", { n: i + 1 })}</span>
                              {["k", "d", "a"].map((f) => (
                                <input key={f} className="cs-input" type="number" min="0" max="100" style={{ padding: "3px 4px", fontSize: 14, textAlign: "center", minWidth: 0 }}
                                  value={r[f]} placeholder={f.toUpperCase()} onClick={(ev) => ev.stopPropagation()}
                                  onChange={(e) => setOcrRows(ocrRows.map((x, j) => (j === i ? { ...x, [f]: e.target.value } : x)))} />
                              ))}
                              <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: r.playerId ? theme.text : theme.textFaint }}>
                                {r.playerId ? nameOf(r.playerId) : t("report.015")}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop: 10 }}>
                          {["A", "B"].map((side) => (
                            <div key={side} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: side === "A" ? theme.accentBright : theme.teamB, width: 84, flexShrink: 0 }}>{sideLabel(side)}</span>
                              {teamOf(side).map((e) => {
                                const assigned = ocrRows.some((r) => r.playerId === e.playerId);
                                return (
                                  <button key={e.playerId} className="cs-btn-ghost" style={{
                                    padding: "4px 10px", fontSize: 13, whiteSpace: "nowrap",
                                    borderColor: assigned ? theme.borderTable : (side === "A" ? theme.accentBright : theme.teamB),
                                    color: assigned ? theme.textFaint : theme.text,
                                    opacity: assigned ? 0.55 : 1,
                                  }} onClick={() => assignPlayerToActiveRow(e.playerId)}>
                                    {e.role} {nameOf(e.playerId)}
                                  </button>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      </>
                    <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <button className="cs-btn" onClick={applyOcrToForm} disabled={!ocrRows.some((r) => r.playerId)}>
                        {t("report.036", { n: ocrRows.filter((r) => r.playerId).length })}
                      </button>
                      <button className="cs-btn-ghost" onClick={clearOcr}>{t("report.020")}</button>
                    </div>
                    <div style={{ fontSize: 13, color: theme.textFaint, marginTop: 4 }}>
                      {t("report.021")}
                    </div>
                  </div>
                  {ocrPreviewUrl && (
                    <div style={{ flex: "1 1 560px", minWidth: 320, maxWidth: 720, position: "sticky", top: 12 }}>
                      <div style={{ fontSize: 13, color: theme.textSub, marginBottom: 4 }}>{t("report.023")}</div>
                      <img src={ocrPreviewUrl} alt={t("report.024")} style={{ width: "100%", borderRadius: 6, border: `1px solid ${theme.border}` }} />
                    </div>
                  )}
                  </div>
                )}
                {reportImage && !ocrRows && (
                  <div style={{ marginTop: 8, fontSize: 13, color: theme.textSub }}>
                    {t("report.025")}
                    <button className="cs-btn-ghost" style={{ marginLeft: 8, padding: "2px 8px", fontSize: 12 }} onClick={() => setReportImage(null)}>{t("report.026")}</button>
                  </div>
                )}
              </div>
              <div className="cs-cols2" style={{ marginBottom: 16 }}>
                {["A", "B"].map((side) => (
                  <div key={side} style={{ ...cardStyle, borderColor: side === "A" ? theme.accentBright : theme.teamB }}>
                    <label style={{ ...labelStyle, color: side === "A" ? theme.accentBright : theme.teamB, fontWeight: 700 }}>{sideLabel(side)}</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                      {teamOf(side).map((e) => (
                        <div key={e.playerId} className="cs-reprow">
                          <select className="cs-input" style={{ padding: "5px 4px" }} value={e.role} onChange={(ev) => setEntryRole(e.playerId, ev.target.value)}>
                            {ROLES.map((r) => {
                              const p = players.find((x) => x.id === e.playerId);
                              return <option key={r} value={r}>{r} {p?.roles[r].prof}</option>;
                            })}
                          </select>
                          <span style={{ fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameOf(e.playerId)}</span>
                          <input className="cs-input" list="champList" style={{ padding: "5px 6px", minWidth: 0 }} placeholder={t("report.017")}
                            value={champLabel(e.champion)} onChange={(ev) => setEntryChampion(e.playerId, ev.target.value)} />
                          {["k", "d", "a"].map((f) => (
                            <input key={f} className="cs-input" style={{ padding: "5px 3px", textAlign: "center", minWidth: 0 }}
                              placeholder={f.toUpperCase()} type="number" min="0"
                              value={kdaInputs[e.playerId]?.[f] ?? ""}
                              onChange={(ev) => setKdaInputs({ ...kdaInputs, [e.playerId]: { ...kdaInputs[e.playerId], [f]: Math.max(0, Math.min(100, Number(ev.target.value))) } })}
                            />
                          ))}
                          <X size={14} style={{ cursor: "pointer", color: theme.textFaint }} onClick={() => removeEntry(e.playerId)} />
                        </div>
                      ))}
                    </div>
                    <select className="cs-input" value="" onChange={(ev) => addEntry(ev.target.value, side)} style={{ width: 180 }}>
                      <option value="">{t("report.027")}</option>
                      {[...players].sort((a, b) => statusRank(a) - statusRank(b))
                        .filter((p) => !entries.some((e) => e.playerId === p.id)).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}{p.status === "rest" ? t("report.028") : p.adjust ? t("report.029") : ""}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 20, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div>
                  <label style={labelStyle}>{t("report.030")}</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="cs-btn-ghost" style={{ borderColor: winner === "A" ? theme.accentBright : theme.borderInput, color: winner === "A" ? theme.accentBright : theme.text }} onClick={() => setWinner("A")}>{t("report.031")}</button>
                    <button className="cs-btn-ghost" style={{ borderColor: winner === "B" ? theme.teamB : theme.borderInput, color: winner === "B" ? theme.teamB : theme.text }} onClick={() => setWinner("B")}>{t("report.032")}</button>
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>{t("report.033")}</label>
                  <input className="cs-input" value={reporterName} onChange={(e) => setReporterName(e.target.value)} placeholder={t("report.034")} style={{ width: 180 }} />
                </div>
                <button className="cs-btn" disabled={teamOf("A").length === 0 || teamOf("B").length === 0 || !winner} onClick={submitReport} style={{ width: 220 }}>
                  {t("report.035")}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------- PLAYER REQUESTS(ランク・熟練度の変更申請) ---------- */}
      {tab === "playerRequests" && (
        <div>
          {rankRequests.length === 0 ? (
            <EmptyState text={t("playerReq.001")} />
          ) : (
            <div style={cardStyle}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{t("playerReq.007", { n: rankRequests.length })}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {rankRequests.map((r) => {
                  const profDiffs = ROLES.filter((role) => r.toProfs[role] !== r.fromProfs[role]);
                  return (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 0", borderBottom: `1px solid ${theme.borderTable}` }}>
                      <span style={{ fontWeight: 700 }}>{r.playerName}</span>
                      <span style={{ color: theme.textSub, display: "flex", flexDirection: "column", gap: 2 }}>
                        {r.toRank !== r.fromRank && <span>{t("shell.021")} {r.fromRank} → <b style={{ color: theme.accent }}>{r.toRank}</b></span>}
                        {profDiffs.length > 0 && <span>{t("playerReq.004")} {profDiffs.map((role) => `${role} ${r.fromProfs[role]}→${r.toProfs[role]}`).join(t("common.003"))}</span>}
                      </span>
                      <span style={{ fontSize: 13, color: theme.textFaint }}>{new Date(r.ts).toLocaleString(dateLocale())}</span>
                      <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                        <button className="cs-btn" style={{ padding: "3px 12px", fontSize: 13 }} onClick={() => approveRankRequest(r.id)}>{t("playerReq.005")}</button>
                        <button className="cs-btn-ghost" style={{ padding: "3px 12px", fontSize: 13 }} onClick={() => rejectRankRequest(r.id)}>{t("playerReq.006")}</button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- PENDING ---------- */}
      {tab === "pending" && (
        <div>
          {pendingMatches.length === 0 ? (
            <EmptyState text={t("pending.001")} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {pendingMatches.map((m) => (
                <div key={m.id} style={cardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: theme.textSub, marginBottom: 8 }}>
                    <span>{t("pending.002")} {m.reporter}</span>
                    <span>{new Date(m.timestamp).toLocaleString(dateLocale())}</span>
                  </div>
                  <div style={m.image ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" } : undefined} className={m.image ? "cs-cols2" : undefined}>
                    <div>
                      <MatchTeams m={m} nameOf={nameOf} />
                      {/* KDA/チャンプ詳細(画像と突き合わせやすいよう一覧表示) */}
                      {m.kda && Object.keys(m.kda).length > 0 && (
                        <table className="cs-table" style={{ marginTop: 8, fontSize: 14 }}>
                          <thead><tr><th>{t("shell.028")}</th><th>{t("shell.030")}</th><th>{t("report.017")}</th><th>KDA</th></tr></thead>
                          <tbody>
                            {m.entries.map((e) => (
                              <tr key={e.playerId}>
                                <td style={{ color: e.team === "A" ? theme.accentBright : theme.teamB, fontWeight: 700 }}>{nameOf(e.playerId)}</td>
                                <td>{e.role}</td>
                                <td>{e.champion || "-"}</td>
                                <td>{m.kda[e.playerId] ? `${m.kda[e.playerId].k}/${m.kda[e.playerId].d}/${m.kda[e.playerId].a}` : "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                    {m.image && (
                      <div>
                        <div style={{ fontSize: 13, color: theme.textSub, marginBottom: 4 }}>{t("pending.003")}</div>
                        <a href={m.image} target="_blank" rel="noreferrer">
                          <img src={m.image} alt="scoreboard" style={{ width: "100%", borderRadius: 6, border: `1px solid ${theme.border}` }} />
                        </a>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button className="cs-btn" onClick={() => approveMatch(m.id)}>{t("pending.004")}</button>
                    <button className="cs-btn-ghost" onClick={() => (editMatchId === m.id ? setEditMatchId(null) : startEditMatch(m))}>{t("pending.005")}</button>
                    <button className="cs-btn-ghost" style={{ borderColor: theme.teamB, color: theme.teamB }} onClick={() => rejectMatch(m.id)}>{t("playerReq.006")}</button>
                  </div>
                  {editMatchId === m.id && editMatchForm && (
                    <MatchEditForm form={editMatchForm} players={players}
                      setEntryField={setEditEntryField} setKda={setEditKda} setEntryPlayer={setEntryPlayer}
                      setWinner={(w) => setEditMatchForm({ ...editMatchForm, winner: w })}
                      error={editMatchError} onSave={saveMatchEdit} onCancel={() => setEditMatchId(null)}
                      champList={ddChamps ? ddChamps.map((x) => x.name) : CHAMPIONS} customChamps={customChamps} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- HISTORY: PLAYER(個別履歴) ---------- */}
      {tab === "historyPlayer" && (
        <div>
          {approvedMatches.length === 0 ? (
            <EmptyState text={t("histP.001")} />
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                <label style={{ fontSize: 16, color: theme.textSub }}>{t("histP.002")}</label>
                <select className="cs-input" value={chartPlayerId || ""} onChange={(e) => setChartPlayerId(e.target.value)}>
                  {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <label style={{ fontSize: 16, color: theme.textSub }}>{t("histP.003")}</label>
                <select className="cs-input" value={chartRole} onChange={(e) => setChartRole(e.target.value)}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div style={{ height: 220, marginBottom: 22 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid stroke={theme.borderTable} />
                    <XAxis dataKey="idx" stroke={theme.textFaint} fontSize={14} label={{ value: t("histP.004"), position: "insideBottom", offset: -3, fill: theme.textFaint, fontSize: 14 }} />
                    <YAxis stroke={theme.textFaint} fontSize={14} domain={["auto", "auto"]} />
                    <Tooltip contentStyle={{ background: theme.surface, border: `1px solid ${theme.borderInput}`, fontSize: 15.5 }} />
                    <Line type="monotone" dataKey="mu" stroke={theme.accentBright} strokeWidth={2} dot={{ r: 2 }} name={t("board.004")} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div style={{ fontSize: 13, color: theme.textFaint, marginBottom: 8 }}>
                {t("histP.005")}
              </div>
              <table className="cs-table">
                <thead><tr><th></th><th>{t("shell.027")}</th><th>{t("report.011")}</th><th>{t("report.012")}</th><th>{t("histP.006")}</th><th></th></tr></thead>
                <tbody>
                  {[...approvedMatches]
                    .filter((m) => !chartPlayerId || m.entries.some((e) => e.playerId === chartPlayerId))
                    .sort((a, b) => b.timestamp - a.timestamp).slice(0, 50)
                    .map((m) => renderMatchRow(m, { readOnly: true }))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* ---------- HISTORY: ALL(全体履歴) ---------- */}
      {tab === "historyAll" && (
        <div>
          {approvedMatches.length === 0 ? (
            <EmptyState text={t("histP.001")} />
          ) : (
            <>
              <div style={{ fontSize: 14, color: theme.textSub, marginBottom: 10 }}>
                {t("histAll.001")} {approvedMatches.length} {t("histAll.002")}
              </div>
              <table className="cs-table">
                <thead><tr><th></th><th>{t("shell.027")}</th><th>{t("report.011")}</th><th>{t("report.012")}</th><th>{t("histP.006")}</th><th></th></tr></thead>
                <tbody>
                  {[...approvedMatches]
                    .sort((a, b) => b.timestamp - a.timestamp).slice(0, 50)
                    .map((m) => renderMatchRow(m, { readOnly: false }))}
                </tbody>
              </table>
              <div style={{ fontSize: 13, color: theme.textFaint, marginTop: 8 }}>
                {t("histAll.003")}
              </div>
            </>
          )}
        </div>
      )}


      {/* ---------- RECORDS (TOP記録) ---------- */}
      {tab === "records" && (() => {
        // 単試合記録: 全選手のkdaHistoryから収集(ロールフィルタ対応)
        const roleFiltered = (h) => recordRole === "ALL" || h.role === recordRole;
        const events = [];
        players.forEach((p) => p.kdaHistory.forEach((h) => {
          if ((h.k != null || h.d != null || h.a != null) && roleFiltered(h)) {
            events.push({ id: p.id, name: p.name, k: h.k || 0, d: h.d || 0, a: h.a || 0, champion: h.champion || "-", role: h.role, ts: h.ts, won: h.won });
          }
        }));
        const top = (key) => [...events].sort((x, y) => y[key] - x[key]).slice(0, 10);
        // 累計・平均系(ロールフィルタ時は3戦/5戦の閾値もそのロール内試合数で判定)
        const agg = computePlayerAggList(players, recordRole);
        const eligible = agg.filter((x) => x.games >= 5);
        const dateOf = (ts) => new Date(ts).toLocaleDateString(dateLocale());
        const RECORD_DEFS = [
          { key: "kill1", label: t("records.001"), rows: top("k").filter((e) => e.k > 0),
            cols: [
              { label: t("shell.028"), get: (r) => r.name, style: { fontWeight: 700 } },
              { label: t("records.002"), get: (r) => r.k, style: { fontWeight: 700, fontSize: 19 } },
              { label: t("report.017"), get: (r) => <><ChampIcon name={r.champion} />{champLabel(r.champion)}</> },
              { label: t("records.003"), get: (r) => dateOf(r.ts), style: { color: theme.textFaint, fontSize: 14 } },
            ] },
          { key: "assist1", label: t("records.004"), rows: top("a").filter((e) => e.a > 0),
            cols: [
              { label: t("shell.028"), get: (r) => r.name, style: { fontWeight: 700 } },
              { label: t("records.005"), get: (r) => r.a, style: { fontWeight: 700, fontSize: 19 } },
              { label: t("report.017"), get: (r) => <><ChampIcon name={r.champion} />{champLabel(r.champion)}</> },
              { label: t("records.003"), get: (r) => dateOf(r.ts), style: { color: theme.textFaint, fontSize: 14 } },
            ] },
          { key: "death1", label: t("records.006"), rows: top("d").filter((e) => e.d > 0),
            cols: [
              { label: t("shell.028"), get: (r) => r.name, style: { fontWeight: 700 } },
              { label: t("records.007"), get: (r) => r.d, style: { fontWeight: 700, fontSize: 19, color: theme.teamB } },
              { label: t("report.017"), get: (r) => <><ChampIcon name={r.champion} />{champLabel(r.champion)}</> },
              { label: t("records.003"), get: (r) => dateOf(r.ts), style: { color: theme.textFaint, fontSize: 14 } },
            ] },
          { key: "killTotal", label: t("records.008"), rows: [...agg].filter((x) => x.totalK > 0).sort((x, y) => y.totalK - x.totalK).slice(0, 10),
            cols: [
              { label: t("shell.028"), get: (r) => r.name, style: { fontWeight: 700 } },
              { label: t("records.008"), get: (r) => r.totalK, style: { fontWeight: 700, fontSize: 19 } },
              { label: t("histP.004"), get: (r) => r.kdaGames, style: { color: theme.textSub } },
            ] },
          { key: "assistTotal", label: t("records.009"), rows: [...agg].filter((x) => x.totalA > 0).sort((x, y) => y.totalA - x.totalA).slice(0, 10),
            cols: [
              { label: t("shell.028"), get: (r) => r.name, style: { fontWeight: 700 } },
              { label: t("records.009"), get: (r) => r.totalA, style: { fontWeight: 700, fontSize: 19 } },
              { label: t("histP.004"), get: (r) => r.kdaGames, style: { color: theme.textSub } },
            ] },
          { key: "deathTotal", label: t("records.010"), rows: [...agg].filter((x) => x.totalD > 0).sort((x, y) => y.totalD - x.totalD).slice(0, 10),
            cols: [
              { label: t("shell.028"), get: (r) => r.name, style: { fontWeight: 700 } },
              { label: t("records.010"), get: (r) => r.totalD, style: { fontWeight: 700, fontSize: 19, color: theme.teamB } },
              { label: t("histP.004"), get: (r) => r.kdaGames, style: { color: theme.textSub } },
            ] },
          { key: "avgK", label: t("records.011"), rows: [...agg].filter((x) => x.kdaGames >= 3).sort((x, y) => y.avgK - x.avgK).slice(0, 10),
            cols: [
              { label: t("shell.028"), get: (r) => r.name, style: { fontWeight: 700 } },
              { label: t("records.011"), get: (r) => r.avgK.toFixed(1), style: { fontWeight: 700, fontSize: 19 } },
              { label: t("records.012"), get: (r) => r.kdaGames, style: { color: theme.textSub } },
            ] },
          { key: "avgA", label: t("records.013"), rows: [...agg].filter((x) => x.kdaGames >= 3).sort((x, y) => y.avgA - x.avgA).slice(0, 10),
            cols: [
              { label: t("shell.028"), get: (r) => r.name, style: { fontWeight: 700 } },
              { label: t("records.013"), get: (r) => r.avgA.toFixed(1), style: { fontWeight: 700, fontSize: 19 } },
              { label: t("records.012"), get: (r) => r.kdaGames, style: { color: theme.textSub } },
            ] },
          { key: "avgD", label: t("records.014"), rows: [...agg].filter((x) => x.kdaGames >= 3).sort((x, y) => y.avgD - x.avgD).slice(0, 10),
            cols: [
              { label: t("shell.028"), get: (r) => r.name, style: { fontWeight: 700 } },
              { label: t("records.014"), get: (r) => r.avgD.toFixed(1), style: { fontWeight: 700, fontSize: 19, color: theme.teamB } },
              { label: t("records.012"), get: (r) => r.kdaGames, style: { color: theme.textSub } },
            ] },
          { key: "wr", label: t("board.006"), rows: [...eligible].sort((x, y) => y.wr - x.wr).slice(0, 10),
            cols: [
              { label: t("shell.028"), get: (r) => r.name, style: { fontWeight: 700 } },
              { label: t("board.006"), get: (r) => `${Math.round(r.wr * 100)}%`, style: { fontWeight: 700, fontSize: 19 } },
              { label: t("histP.004"), get: (r) => r.games, style: { color: theme.textSub } },
            ] },
          { key: "kda", label: t("records.015"), rows: [...eligible].filter((x) => x.kdaGames >= 5).sort((x, y) => y.kdaRatio - x.kdaRatio).slice(0, 10),
            cols: [
              { label: t("shell.028"), get: (r) => r.name, style: { fontWeight: 700 } },
              { label: "KDA", get: (r) => r.kdaRatio.toFixed(2), style: { fontWeight: 700, fontSize: 19 } },
              { label: t("records.012"), get: (r) => r.kdaGames, style: { color: theme.textSub } },
            ] },
          // 参加回数: 勝敗が確定した試合数。閾値を設けず全選手を対象にする(参加を促す指標のため)
          { key: "games", label: t("records.026"), headRight: t("records.027", { n: approvedMatches.length }),
            rows: [...agg].filter((x) => x.games > 0).sort((x, y) => y.games - x.games).slice(0, 10),
            cols: [
              { label: t("shell.028"), get: (r) => r.name, style: { fontWeight: 700 } },
              { label: t("records.026"), get: (r) => r.games, style: { fontWeight: 700, fontSize: 19 } },
              { label: t("records.028"), get: (r) => (approvedMatches.length ? `${Math.round(r.games / approvedMatches.length * 100)}%` : "-"), style: { color: theme.textSub } },
              { label: t("board.006"), get: (r) => `${Math.round(r.wr * 100)}%`, style: { color: theme.textSub } },
            ] },
        ];
        const active = RECORD_DEFS.find((d) => d.key === recordSubTab) || RECORD_DEFS[0];
        // 全登録試合のサイド別勝率
        const sideAgg = { A: 0, B: 0 };
        approvedMatches.forEach((m) => { if (sideAgg[m.winner] != null) sideAgg[m.winner]++; });
        const sideTotal = sideAgg.A + sideAgg.B;

        // ---- 選手詳細パネル(右側)用データ。サブタブ共通で選択選手を保持する ----
        const selectedId = (recordSelectedPlayerId && players.some((p) => p.id === recordSelectedPlayerId))
          ? recordSelectedPlayerId
          : (active.rows[0]?.id ?? players[0]?.id ?? null);
        const selectedPlayer = players.find((p) => p.id === selectedId) || null;
        const detail = selectedPlayer && computePlayerProfile(selectedPlayer, recordRole, players, matches, approvedMatches);

        // スコア一覧の比較マーカー: 現在のロールフィルタと同条件(3戦以上)の他選手平均
        const cmpAvg = computeCmpAvg(agg, selectedId);
        return (
          <div>
            <div style={{ ...cardStyle, marginBottom: 14, display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: theme.textSub }}>{t("records.025", { n: sideTotal })}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: theme.accentBright }}>
                {t("records.018")} {sideTotal ? Math.round(sideAgg.A / sideTotal * 100) : "-"}%
                <span style={{ fontSize: 13, color: theme.textFaint, fontWeight: 400 }}> ({sideAgg.A}{t("records.019")}</span>
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: theme.teamB }}>
                {t("records.020")} {sideTotal ? Math.round(sideAgg.B / sideTotal * 100) : "-"}%
                <span style={{ fontSize: 13, color: theme.textFaint, fontWeight: 400 }}> ({sideAgg.B}{t("records.019")}</span>
              </div>
              {sideTotal > 0 && (
                <div style={{ flex: "1 1 160px", minWidth: 120, height: 10, borderRadius: 5, overflow: "hidden", display: "flex", border: `1px solid ${theme.border}` }}>
                  <div style={{ width: `${(sideAgg.A / sideTotal) * 100}%`, background: theme.accentBright }} />
                  <div style={{ flex: 1, background: theme.teamB }} />
                </div>
              )}
            </div>
            <div className="cs-scroll" style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              {["ALL", ...ROLES].map((r) => (
                <button key={r} className="cs-btn-ghost"
                  style={{ padding: "5px 12px", fontSize: 14, whiteSpace: "nowrap",
                    borderColor: recordRole === r ? theme.accent : theme.borderInput,
                    color: recordRole === r ? theme.accent : theme.textSub,
                    fontWeight: recordRole === r ? 700 : 400 }}
                  onClick={() => setRecordRole(r)}>
                  {r === "ALL" ? t("board.001") : r}
                </button>
              ))}
            </div>
            <div className="cs-scroll" style={{ display: "flex", gap: 4, overflowX: "auto", marginBottom: 14 }}>
              {RECORD_DEFS.map((d) => (
                <button key={d.key} className="cs-btn-ghost"
                  style={{ padding: "7px 16px", fontSize: 15, whiteSpace: "nowrap",
                    borderColor: recordSubTab === d.key ? theme.accent : theme.borderInput,
                    color: recordSubTab === d.key ? theme.accent : theme.textSub,
                    fontWeight: recordSubTab === d.key ? 700 : 500 }}
                  onClick={() => setRecordSubTab(d.key)}>
                  {d.label}
                </button>
              ))}
            </div>
            <div className="cs-side-narrow">
              <div style={cardStyle}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
                  <div style={{ fontSize: 19, fontWeight: 700, color: theme.accent }}>{active.label}（{active.key.startsWith("kill1") || active.key === "assist1" || active.key === "death1" ? t("records.021") : active.key === "wr" || active.key === "kda" ? t("records.022") : t("records.023")}）</div>
                  {active.headRight && (
                    <div style={{ fontSize: 19, fontWeight: 700, color: theme.textSub }}>{active.headRight}</div>
                  )}
                </div>
                {active.rows.length === 0 ? (
                  <div style={{ fontSize: 15, color: theme.faintAccent }}>{t("records.024")}</div>
                ) : (
                  <table className="cs-table">
                    <thead><tr><th>#</th>{active.cols.map((cl) => <th key={cl.label}>{cl.label}</th>)}</tr></thead>
                    <tbody>
                      {active.rows.map((r, i) => (
                        <tr key={i} onClick={() => r.id && setRecordSelectedPlayerId(r.id)}
                          style={{ cursor: r.id ? "pointer" : "default", background: r.id && r.id === selectedId ? theme.surfaceAlt : "transparent" }}>
                          <td style={{ color: i < 3 ? theme.accent : theme.textSub, fontWeight: 700 }}>{i + 1}</td>
                          {active.cols.map((cl) => <td key={cl.label} style={cl.style}>{cl.get(r)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div>
                {!detail ? (
                  <EmptyState text={t("records.024")} />
                ) : (
                  <>
                    <div style={{ ...cardStyle, marginBottom: 12, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{detail.p.name}</div>
                        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                          {detail.roleBadges.map(([role, n]) => (
                            <span key={role} style={{ fontSize: 13, fontWeight: 700, padding: "2px 8px", borderRadius: 10, border: `1px solid ${theme.borderInput}`, color: theme.textSub }}>
                              {role} {n}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 20 }}>
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 13, color: theme.textFaint }}>{t("records.031")}</div>
                          <div style={{ fontSize: 20, fontWeight: 700 }}>{detail.games}</div>
                        </div>
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 13, color: theme.textFaint }}>{t("board.006")}</div>
                          <div style={{ fontSize: 20, fontWeight: 700, color: theme.accentBright }}>{Math.round(detail.wr * 100)}%</div>
                        </div>
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 13, color: theme.textFaint }}>KDA</div>
                          <div style={{ fontSize: 20, fontWeight: 700 }}>{detail.kdaRatio.toFixed(2)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="cs-cols2" style={{ marginBottom: 12 }}>
                      <div style={cardStyle}>
                        <div style={{ fontSize: 13, color: theme.textSub, marginBottom: 8, fontWeight: 700 }}>{t("stats.012")}</div>
                        {["A", "B"].map((s) => {
                          const st = detail.sideStat[s];
                          const pct = st.g ? Math.round((st.w / st.g) * 100) : 0;
                          return (
                            <div key={s} style={{ marginBottom: 8 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
                                <span>{sideLabel(s)} ({st.g})</span>
                                <span style={{ fontWeight: 700 }}>{st.g ? `${pct}%` : "-"}</span>
                              </div>
                              <div style={{ height: 6, borderRadius: 3, background: theme.borderTable, overflow: "hidden", marginTop: 3 }}>
                                <div style={{ width: `${pct}%`, height: "100%", background: s === "A" ? theme.accentBright : theme.teamB }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div style={cardStyle}>
                        <div style={{ fontSize: 13, color: theme.textSub, marginBottom: 8, fontWeight: 700 }}>{t("records.016")}</div>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                          {detail.recent.length === 0 ? (
                            <span style={{ fontSize: 13, color: theme.faintAccent }}>{t("stats.015")}</span>
                          ) : detail.recent.map((h, i) => (
                            <img key={i} src={h.won ? WIN_BADGE_IMG : LOSE_BADGE_IMG} alt={h.won ? t("shell.034") : t("shell.035")} title={h.won ? t("shell.034") : t("shell.035")}
                              style={{ width: 26, height: 26, objectFit: "contain", background: "var(--cs-badgeBg)", borderRadius: 4, padding: 1 }} />
                          ))}
                        </div>
                        {detail.recent.length > 0 && (
                          <div style={{ fontSize: 13, color: theme.textSub }}>
                            {t("records.032", { w: detail.recentWins, l: detail.recent.length - detail.recentWins })}
                            {detail.streak >= 2 && (detail.streakWon ? t("records.033", { n: detail.streak }) : t("records.034", { n: detail.streak }))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ ...cardStyle, marginBottom: 12 }}>
                      <div style={{ fontSize: 13, color: theme.textSub, marginBottom: 8, fontWeight: 700 }}>{t("records.017")}</div>
                      {scoreBarRows(detail, cmpAvg)}
                    </div>

                    <div className="cs-cols2">
                      <div style={cardStyle}>
                        <div style={{ fontSize: 13, color: theme.textSub, marginBottom: 8, fontWeight: 700 }}>{t("records.029")}</div>
                        {detail.synergyList.length === 0 ? (
                          <div style={{ fontSize: 13, color: theme.faintAccent }}>{t("records.024")}</div>
                        ) : detail.synergyList.map((x) => pairRow(x, theme.accentBright))}
                      </div>
                      <div style={cardStyle}>
                        <div style={{ fontSize: 13, color: theme.textSub, marginBottom: 8, fontWeight: 700 }}>{t("records.030")}</div>
                        {detail.counterList.length === 0 ? (
                          <div style={{ fontSize: 13, color: theme.faintAccent }}>{t("records.024")}</div>
                        ) : detail.counterList.map((x) => pairRow(x, theme.teamB))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ---------- RATE TABLE(ランク別レート基準の早見表) ---------- */}
      {tab === "rateTable" && (
        <div>
          <div style={{ ...cardStyle, marginBottom: 12, fontSize: 13, color: theme.textSub, lineHeight: 1.7 }}>
            {t("board.015")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, alignItems: "start" }}>
            <div>
              <table className="cs-table">
                <thead><tr><th>{t("board.016")}</th><th>{t("board.017")}</th></tr></thead>
                <tbody>
                  {RANKS.map(([label, mu]) => (
                    <tr key={label}>
                      <td style={{ fontWeight: 700 }}>{rankLabel(label)}</td>
                      <td style={{ fontSize: 17, fontWeight: 700 }}>{mu}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div style={{ fontSize: 15, color: theme.textSub, marginBottom: 6, fontWeight: 700 }}>{t("board.018")}</div>
              <table className="cs-table">
                <thead><tr><th>{t("board.019")}</th><th>×</th></tr></thead>
                <tbody>
                  {PROFS.map((pf) => (
                    <tr key={pf}>
                      <td><ProfBadge prof={pf} /></td>
                      <td style={{ fontSize: 17, fontWeight: 700 }}>{PROF_RATE[pf].toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------- ITEM EFFICIENCY(アイテム金銭効率) ---------- */}
      {tab === "itemEfficiency" && <ItemEfficiencyTab />}

      {/* ---------- PERSONAL STATS ---------- */}
      {/* ---------- SCOUT: MULTI SEARCH(ロール別対面比較) ---------- */}
      {tab === "scoutMulti" && (() => {
        if (!balanceResult || !balanceResult.teamA) {
          return <EmptyState text={t("scoutMulti.001")} />;
        }
        const statFor = (playerId, role) => {
          const p = players.find((x) => x.id === playerId);
          if (!p) return null;
          const rh = p.kdaHistory.filter((h) => h.role === role);
          const wins = rh.filter((h) => h.won).length;
          const kdaGames = rh.filter((h) => h.k != null);
          const sum = (f) => kdaGames.reduce((s, h) => s + (h[f] || 0), 0);
          // 得意チャンピオンTOP3: 試合数の多い順(同数は勝率順)。champion未記録は除外。
          const cc = {};
          p.kdaHistory.forEach((h) => {
            if (!h.champion) return;
            if (!cc[h.champion]) cc[h.champion] = { games: 0, wins: 0 };
            cc[h.champion].games++;
            if (h.won) cc[h.champion].wins++;
          });
          const top = Object.entries(cc)
            .sort((a, b) => b[1].games - a[1].games || (b[1].wins / b[1].games) - (a[1].wins / a[1].games))
            .slice(0, 3);
          return {
            p,
            roleMu: p.roles[role]?.mu,
            roleSigma: p.roles[role]?.sigma,
            prof: p.roles[role]?.prof,
            games: rh.length, wins, losses: rh.length - wins,
            avgKda: kdaGames.length ? `${(sum("k")/kdaGames.length).toFixed(1)}/${(sum("d")/kdaGames.length).toFixed(1)}/${(sum("a")/kdaGames.length).toFixed(1)}` : "-",
            kdRatio: kdaGames.length ? ((sum("k")+sum("a"))/Math.max(sum("d"),1)).toFixed(2) : null,
            topChamps: top,
            url: opggUrl(p.summonerName),
          };
        };
        const sideCell = (s, align) => {
          if (!s) return <td colSpan={2} style={{ color: theme.textFaint }}>-</td>;
          return (
            <td style={{ textAlign: align, padding: "10px 12px" }}>
              <div style={{ fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", gap: 6, justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
                {align === "right" && s.url && (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" title={t("scoutMulti.002")} style={{ color: theme.accentBright, display: "inline-flex" }}>
                    <ExternalLink size={14} />
                  </a>
                )}
                <span style={{ cursor: "pointer" }} onClick={() => { setScoutPlayerId(s.p.id); setTab("scoutStats"); }} title={t("scoutMulti.003")}>{s.p.name}</span>
                {align === "left" && s.url && (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" title={t("scoutMulti.002")} style={{ color: theme.accentBright, display: "inline-flex" }}>
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
              <div style={{ fontSize: 13, color: theme.textSub, marginTop: 2 }}>
                {rankLabel(s.p.rank)} {t("scoutMulti.004")} {s.roleMu != null ? s.roleMu.toFixed(1) : "-"}pt <ProfBadge prof={s.prof} />
              </div>
              <div style={{ fontSize: 13, color: theme.textSub }}>
                {s.games ? t("scoutMulti.018", { w: s.wins, l: s.losses }) : t("scoutMulti.005")}{s.kdRatio ? t("scoutMulti.019", { kda: s.avgKda, kd: s.kdRatio }) : ""}
              </div>
              <div style={{ fontSize: 13, color: theme.textFaint, marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
                {s.topChamps.length ? s.topChamps.map(([n, st]) => (
                  <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 2 }} title={champLabel(n)}>
                    <ChampIcon name={n} size={18} />
                    {t("scoutMulti.017", { games: st.games, pct: Math.round((st.wins / st.games) * 100) })}
                  </span>
                )) : t("scoutMulti.007")}
              </div>
            </td>
          );
        };
        return (
          <div>
            <div style={{ fontSize: 14, color: theme.textSub, marginBottom: 10 }}>
              {t("scoutMulti.008")}
            </div>
            {balanceResult.teamA.length === 5 && balanceResult.teamB.length === 5 && (() => {
              const teamAFull = balanceResult.teamA.map((x) => ({ mu: x.mu, sigma: players.find((p) => p.id === x.id)?.roles[x.role]?.sigma ?? SIGMA_RATED }));
              const teamBFull = balanceResult.teamB.map((x) => ({ mu: x.mu, sigma: players.find((p) => p.id === x.id)?.roles[x.role]?.sigma ?? SIGMA_RATED }));
              const pA = teamWinProb(teamAFull, teamBFull);
              const pct = Math.round(pA * 100);
              return (
                <div style={{ ...cardStyle, marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
                    <span style={{ color: theme.accentBright }}>{t("scoutMulti.009")} {pct}%</span>
                    <span style={{ color: theme.teamB }}>{t("scoutMulti.010")} {100 - pct}%</span>
                  </div>
                  <div style={{ display: "flex", height: 16, borderRadius: 8, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, background: `linear-gradient(135deg, var(--cs-headFrom), var(--cs-headTo))` }} />
                    <div style={{ width: `${100 - pct}%`, background: `linear-gradient(135deg, var(--cs-headBFrom), var(--cs-headBTo))` }} />
                  </div>
                  <div style={{ fontSize: 12, color: theme.textFaint, marginTop: 6 }}>
                    {t("scoutMulti.011")}
                  </div>
                </div>
              );
            })()}
            <table className="cs-table">
              <thead>
                <tr>
                  <th style={{ width: "44%", background: "linear-gradient(135deg, var(--cs-headFrom), var(--cs-headTo))" }}>{t("report.011")}</th>
                  <th style={{ width: "12%" }}>{t("shell.030")}</th>
                  <th style={{ width: "44%", background: "linear-gradient(135deg, var(--cs-headBFrom), var(--cs-headBTo))" }}>{t("report.012")}</th>
                </tr>
              </thead>
              <tbody>
                {ROLES.map((role) => {
                  const a = balanceResult.teamA.find((x) => x.role === role);
                  const b = balanceResult.teamB.find((x) => x.role === role);
                  const sa = a ? statFor(a.id, role) : null;
                  const sb = b ? statFor(b.id, role) : null;
                  const diff = sa?.roleMu != null && sb?.roleMu != null ? sa.roleMu - sb.roleMu : null;
                  const gapWarn = warnRoles.has(role);
                  return (
                    <tr key={role} style={{ boxShadow: gapWarn ? `inset 0 0 0 2px ${theme.teamB}` : "none" }}>
                      {sideCell(sa, "right")}
                      <td style={{ fontWeight: 700, fontSize: 15 }}>
                        {role}
                        {diff != null && (
                          <div style={{ fontSize: 12, fontWeight: 700, color: diff > 0 ? theme.accentBright : diff < 0 ? theme.teamB : theme.textFaint }}>
                            {diff > 0 ? t("scoutMulti.015", { v: diff.toFixed(1) }) : diff < 0 ? t("scoutMulti.016", { v: (-diff).toFixed(1) }) : t("scoutMulti.012")}
                          </div>
                        )}
                        {gapWarn && <div style={{ fontSize: 11.5, fontWeight: 700, color: theme.teamB, marginTop: 2 }}>{t("scoutMulti.021")}</div>}
                        {sa?.roleMu != null && sb?.roleMu != null && sa.roleSigma != null && sb.roleSigma != null && (() => {
                          const pA = winProb(sa.roleMu, sa.roleSigma, sb.roleMu, sb.roleSigma);
                          const pct = Math.round(pA * 100);
                          // このレーティング方式ではσ収束後でも1ディビジョン差(数pt)が数%の差にしかならないため、
                          // 「互角」帯を49〜51%(±1pt)まで狭め、それ以外は必ず数値を表示する(以前の45〜55%は
                          // 実質ほぼ全ケースを飲み込んでしまい、意味のある差を隠していたため)
                          const even = pct >= 49 && pct <= 51;
                          return (
                            <div style={{ marginTop: 6 }} title={t("scoutMulti.013")}>
                              <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", border: even ? `1px solid ${theme.accent}` : "none" }}>
                                <div style={{ width: `${pct}%`, background: theme.accentBright }} />
                                <div style={{ width: `${100 - pct}%`, background: theme.teamB }} />
                              </div>
                              <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2, color: theme.textFaint }}>
                                {pct}% | {100 - pct}%{even && t("scoutMulti.014")}
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      {sideCell(sb, "left")}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {matchupWarnings.length > 0 && (
              <div style={{ fontSize: 13, color: theme.textSub, marginTop: 8 }}>
                {t("scoutMulti.022", { th: matchupThreshold })}
              </div>
            )}
          </div>
        );
      })()}

      {(tab === "stats" || tab === "scoutStats") && (() => {
        const restricted = tab === "scoutStats";
        const pool = restricted ? players.filter((p) => seating.seatedIds.includes(p.id)) : players;
        const curId = restricted ? scoutPlayerId : statsPlayerId;
        const setCurId = restricted ? setScoutPlayerId : setStatsPlayerId;
        return (
        <div>
          {restricted && pool.length === 0 ? (
            <EmptyState text={t("stats.001")} />
          ) : pool.length === 0 ? (
            <EmptyState text={t("stats.002")} />
          ) : (() => {
            const sp = pool.find((p) => p.id === (curId || pool[0].id)) || pool[0];
            const profile = computePlayerProfile(sp, "ALL", players, matches, approvedMatches);
            const cmpAvg = computeCmpAvg(computePlayerAggList(players, "ALL"), sp.id);
            const hist = profile.history;
            const byRole = ROLES.map((r) => {
              const h = hist.filter((x) => x.role === r);
              const w = h.filter((x) => x.won).length;
              return { role: r, games: h.length, wins: w, losses: h.length - w };
            });
            const champCount = {};
            hist.forEach((x) => { if (x.champion) champCount[x.champion] = (champCount[x.champion] || 0) + 1; });
            const topChamps = Object.entries(champCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
            // 得意ロール: 実効レート(mu)の高い順に上位3ロール
            const bestRoles = [...ROLES].sort((a, b) => sp.roles[b].mu - sp.roles[a].mu).slice(0, 3)
              .map((r) => ({ role: r, mu: sp.roles[r].mu, ...byRole.find((x) => x.role === r) }));
            // 最新の傾向: 直近5戦の成績に加え、平均より抜きん出ているロール(3戦以上・KDAが全体平均超え)があれば1つ添える
            const trendText = (() => {
              if (!hist.length) return null;
              const recent5 = profile.recent.slice(0, 5);
              const w5 = recent5.filter((h) => h.won).length;
              const l5 = recent5.length - w5;
              const roleKda = ROLES.map((r) => {
                const h = hist.filter((x) => x.role === r && (x.k != null || x.d != null || x.a != null));
                if (h.length < 3) return null;
                const sum = (f) => h.reduce((s, x) => s + (x[f] || 0), 0);
                return { role: r, kda: (sum("k") + sum("a")) / Math.max(sum("d"), 1) };
              }).filter(Boolean);
              const best = roleKda.filter((x) => x.kda > profile.kdaRatio).sort((a, b) => b.kda - a.kda)[0];
              return best
                ? t("stats.040", { n: recent5.length, w: w5, l: l5, role: best.role, kda: best.kda.toFixed(1), overall: profile.kdaRatio.toFixed(2) })
                : t("stats.039", { n: recent5.length, w: w5, l: l5 });
            })();
            // 試合ログ: フィルタチップ(ロールは試合数の多い順)と絞り込み済み行(新しい順)
            const logRoleChips = [...byRole].filter((r) => r.games > 0).sort((a, b) => b.games - a.games);
            const logRows = [...hist].reverse().filter((h) => {
              if (statsLogFilter === "ALL") return true;
              if (statsLogFilter === "WIN") return h.won;
              if (statsLogFilter === "LOSE") return h.won === false;
              return h.role === statsLogFilter;
            });
            return (
              <>
                <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                  <button className="cs-btn-ghost" style={{ fontSize: 15 }} onClick={() => setStatsPickerOpen(!statsPickerOpen)}>
                    {t("histP.002")} <b style={{ color: theme.accent, marginLeft: 4 }}>{sp.name}</b> {statsPickerOpen ? "▲" : t("stats.003")}
                  </button>
                  <span style={{ fontSize: 19, fontWeight: 700, color: theme.accent }}>
                    {rankLabel(sp.rank)} <span style={{ color: theme.textFaint, fontWeight: 400, fontSize: 16 }}>/</span> {t("stats.004")} {sp.wins}{t("board.010")}{sp.losses}{t("board.011")}
                  </span>
                  {opggUrl(sp.summonerName) && (
                    <a href={opggUrl(sp.summonerName)} target="_blank" rel="noopener noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 3, color: theme.accentBright, fontSize: 15 }}>
                      <ExternalLink size={14} />{t("scoutMulti.002")}
                    </a>
                  )}
                </div>

                {statsPickerOpen && (
                  <div style={{ ...cardStyle, marginBottom: 14 }}>
                    <input className="cs-input" style={{ width: "100%", marginBottom: 10, boxSizing: "border-box" }} placeholder={t("stats.005")}
                      value={statsSearch} onChange={(e) => setStatsSearch(e.target.value)} />
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, maxHeight: 280, overflowY: "auto" }}>
                      {[...pool].sort((a, b) => statusRank(a) - statusRank(b) || a.name.localeCompare(b.name, "ja"))
                        .filter((p) => p.name.includes(statsSearch.trim()))
                        .map((p) => {
                          const total = p.wins + p.losses;
                          const wr = total ? Math.round((p.wins / total) * 100) : null;
                          return (
                            <div key={p.id} onClick={() => { setCurId(p.id); setStatsPickerOpen(false); setStatsSearch(""); setChampExpanded(false); setStatsLogFilter("ALL"); }}
                              style={{
                                cursor: "pointer", padding: "8px 10px", borderRadius: 6,
                                border: `1px solid ${p.id === sp.id ? theme.accentBright : theme.borderInput}`,
                                background: p.id === sp.id ? theme.surfaceAlt : theme.surfaceWhite,
                                opacity: p.status === "rest" ? 0.55 : 1,
                              }}>
                              <div style={{ fontWeight: 700, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {p.name}{p.status === "rest" && <span style={{ fontSize: 12, color: theme.teamB, marginLeft: 4 }}>{t("stats.006")}</span>}{p.adjust && <span style={{ fontSize: 12, color: theme.accent, marginLeft: 4 }}>{t("stats.007")}</span>}
                              </div>
                              <div style={{ fontSize: 13, color: theme.textFaint }}>
                                {rankLabel(p.rank)}{wr != null && t("stats.026", { wr })}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                  <div style={{ ...cardStyle, flex: "1 1 160px" }}>
                    <div style={{ fontSize: 14, color: theme.textSub, marginBottom: 6 }}>{t("stats.010")}</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>
                      {approvedMatches.length ? Math.round((sp.wins + sp.losses) / approvedMatches.length * 100) : 0}%
                      <span style={{ fontSize: 14, color: theme.textFaint, fontWeight: 400 }}>{t("stats.027", { a: sp.wins + sp.losses, b: approvedMatches.length })}</span>
                    </div>
                  </div>
                  <div style={{ ...cardStyle, flex: "1 1 160px" }}>
                    <div style={{ fontSize: 14, color: theme.textSub, marginBottom: 6 }}>{t("records.015")}</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>
                      {profile.kdaRatio.toFixed(2)}
                      {cmpAvg.kdaRatio != null && <span style={{ fontSize: 14, color: theme.textFaint, fontWeight: 400 }}> {t("records.035", { v: cmpAvg.kdaRatio.toFixed(2) })}</span>}
                    </div>
                  </div>
                  <div style={{ ...cardStyle, flex: "1 1 160px" }}>
                    <div style={{ fontSize: 14, color: theme.textSub, marginBottom: 6 }}>{t("board.006")}</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>
                      {Math.round(profile.wr * 100)}%
                      {cmpAvg.wr != null && <span style={{ fontSize: 14, color: theme.textFaint, fontWeight: 400 }}> {t("records.035", { v: `${Math.round(cmpAvg.wr * 100)}%` })}</span>}
                    </div>
                  </div>
                  <div style={{ ...cardStyle, flex: "1 1 200px" }}>
                    <div style={{ fontSize: 14, color: theme.textSub, marginBottom: 6 }}>{t("stats.012")}</div>
                    {["A", "B"].map((s) => {
                      const st = profile.sideStat[s];
                      return (
                        <div key={s} style={{ fontSize: 15, fontWeight: 700, color: s === "A" ? theme.accentBright : theme.teamB }}>
                          {sideLabel(s)}: {st.g ? `${Math.round((st.w / st.g) * 100)}%` : "-"}
                          <span style={{ fontSize: 13, color: theme.textFaint, fontWeight: 400 }}> ({st.w}{t("board.010")}{st.g - st.w}{t("stats.013")}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="cs-scroll" style={{ display: "flex", gap: 4, marginBottom: 14 }}>
                  {[["overview", t("stats.009")], ["roleChamp", t("stats.030")], ["log", t("stats.031")]].map(([key, label]) => (
                    <button key={key} className="cs-btn-ghost"
                      style={{ padding: "7px 16px", fontSize: 15, whiteSpace: "nowrap",
                        borderColor: statsSubTab === key ? theme.accent : theme.borderInput,
                        color: statsSubTab === key ? theme.accent : theme.textSub,
                        fontWeight: statsSubTab === key ? 700 : 500 }}
                      onClick={() => setStatsSubTab(key)}>
                      {label}{key === "log" && hist.length > 0 && <span style={{ marginLeft: 6, fontSize: 13, color: theme.textFaint }}>{hist.length}</span>}
                    </button>
                  ))}
                </div>

                {statsSubTab === "overview" && (
                  <>
                    <div className="cs-cols2-wide">
                      <div>
                        <div style={{ ...cardStyle, marginBottom: 16 }}>
                          <div style={{ fontSize: 14, color: theme.textSub, marginBottom: 8, fontWeight: 700 }}>{t("records.017")}{t("stats.032")}</div>
                          {scoreBarRows(profile, cmpAvg)}
                        </div>
                      </div>
                      <div>
                        <div style={{ ...cardStyle, marginBottom: 16 }}>
                          <div style={{ fontSize: 14, color: theme.textSub, marginBottom: 6 }}>{t("stats.014")}</div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center", minHeight: 36, flexWrap: "wrap" }}>
                            {profile.recent.slice(0, 8).map((h, j) => (
                              <img key={j} src={h.won ? WIN_BADGE_IMG : LOSE_BADGE_IMG} alt={h.won ? t("shell.034") : t("shell.035")} title={h.won ? t("shell.034") : t("shell.035")}
                                style={{ width: 34, height: 34, objectFit: "contain", flexShrink: 0, background: "var(--cs-badgeBg)", borderRadius: 5, padding: 1 }} />
                            ))}
                            {hist.length === 0 && <span style={{ fontSize: 14, color: theme.faintAccent }}>{t("stats.015")}</span>}
                          </div>
                        </div>
                        <div style={{ ...cardStyle, marginBottom: 16 }}>
                          <div style={{ fontSize: 14, color: theme.textSub, marginBottom: 8, fontWeight: 700 }}>{t("stats.033")}</div>
                          {bestRoles.map((r) => (
                            <div key={r.role} style={{ marginBottom: 8 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                                <span style={{ fontWeight: 700 }}>{r.role}</span>
                                <span style={{ fontSize: 13, color: theme.textSub }}>{t("stats.041", { mu: r.mu.toFixed(1), w: r.wins, l: r.losses })}</span>
                              </div>
                              <div style={{ height: 6, borderRadius: 3, background: theme.borderTable, overflow: "hidden", marginTop: 3 }}>
                                <div style={{ width: `${Math.max(0, Math.min(100, (r.mu / 130) * 100))}%`, height: "100%", background: theme.accentBright }} />
                              </div>
                            </div>
                          ))}
                        </div>
                        <div style={{ ...cardStyle, marginBottom: 16 }}>
                          <div style={{ fontSize: 14, color: theme.textSub, marginBottom: 8, fontWeight: 700 }}>{t("stats.016")}</div>
                          {topChamps.length ? (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                              {topChamps.map(([n, cnt]) => (
                                <div key={n} style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${theme.borderInput}`, borderRadius: 6, padding: "6px 8px", fontSize: 14 }}>
                                  <ChampIcon name={n} />{champLabel(n)}({cnt})
                                </div>
                              ))}
                            </div>
                          ) : <span style={{ fontSize: 14, color: theme.faintAccent }}>{t("stats.015")}</span>}
                        </div>
                      </div>
                    </div>

                    {trendText && (
                      <div style={{ ...cardStyle, marginBottom: 16 }}>
                        <div style={{ fontSize: 14, color: theme.textSub, marginBottom: 6, fontWeight: 700 }}>{t("stats.038")}</div>
                        <div style={{ fontSize: 14, lineHeight: 1.7 }}>{trendText}</div>
                      </div>
                    )}

                    <div className="cs-cols2">
                      <div style={cardStyle}>
                        <div style={{ fontSize: 14, color: theme.textSub, marginBottom: 8, fontWeight: 700 }}>{t("records.029")}</div>
                        {profile.synergyList.length === 0 ? (
                          <div style={{ fontSize: 13, color: theme.faintAccent }}>{t("records.024")}</div>
                        ) : profile.synergyList.map((x) => pairRow(x, theme.accentBright))}
                      </div>
                      <div style={cardStyle}>
                        <div style={{ fontSize: 14, color: theme.textSub, marginBottom: 8, fontWeight: 700 }}>{t("records.030")}</div>
                        {profile.counterList.length === 0 ? (
                          <div style={{ fontSize: 13, color: theme.faintAccent }}>{t("records.024")}</div>
                        ) : profile.counterList.map((x) => pairRow(x, theme.teamB))}
                      </div>
                    </div>
                  </>
                )}

                {statsSubTab === "roleChamp" && (
                  <>
                    <div style={{ fontSize: 16, color: theme.textSub, marginBottom: 6 }}>{t("stats.017")}</div>
                    <table className="cs-table" style={{ marginBottom: 20 }}>
                      <thead><tr><th>{t("shell.030")}</th><th>{t("stats.018")}</th><th>{t("stats.019")}</th><th>{t("board.004")}</th><th>{t("stats.020")}</th><th>{t("stats.021")}</th><th>{t("board.007")}</th></tr></thead>
                      <tbody>
                        {byRole.map((r) => {
                          const h = hist.filter((x) => x.role === r.role && (x.k != null || x.d != null || x.a != null));
                          const n = h.length;
                          const av = (f) => n ? (h.reduce((s, x) => s + (x[f] || 0), 0) / n).toFixed(1) : "-";
                          return (
                            <tr key={r.role}>
                              <td style={{ fontWeight: 700 }}>{r.role}</td>
                              <td><ProfBadge prof={sp.roles[r.role].prof} /></td>
                              <td><ProfBadge prof={effectiveProf(sp.roles[r.role].mu, effectiveBaseMu(sp))} /></td>
                              <td style={{ fontSize: 17, fontWeight: 700 }}>{sp.roles[r.role].mu.toFixed(1)}</td>
                              <td>{r.games}</td>
                              <td style={{ color: theme.textSub }}>{r.wins}{t("board.010")}{r.losses}{t("board.011")}</td>
                              <td style={{ fontSize: 17, fontWeight: 700 }}>{n ? `${av("k")}/${av("d")}/${av("a")}` : "-"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    <div style={{ fontSize: 16, color: theme.textSub, marginBottom: 6 }}>{t("stats.022")}</div>
                    {(() => {
                      const byChamp = {};
                      hist.forEach((x) => {
                        if (!x.champion) return;
                        if (!byChamp[x.champion]) byChamp[x.champion] = { games: 0, wins: 0, k: 0, d: 0, a: 0, kn: 0 };
                        const b = byChamp[x.champion];
                        b.games++; if (x.won) b.wins++;
                        if (x.k != null || x.d != null || x.a != null) { b.k += x.k || 0; b.d += x.d || 0; b.a += x.a || 0; b.kn++; }
                      });
                      // 「成績のいい順」= 勝率降順、同率は試合数が多い方を上位に(1戦1勝が最上位に来るのを避ける)
                      const rows = Object.entries(byChamp).sort((a, b) => {
                        const wrA = a[1].wins / a[1].games, wrB = b[1].wins / b[1].games;
                        return wrB - wrA || b[1].games - a[1].games;
                      });
                      if (!rows.length) return <EmptyState text={t("stats.023")} />;
                      const shown = champExpanded ? rows : rows.slice(0, 5);
                      return (
                        <>
                        <table className="cs-table" style={{ marginBottom: rows.length > 5 ? 6 : 20 }}>
                          <thead><tr><th>{t("shell.031")}</th><th>{t("stats.020")}</th><th>{t("stats.021")}</th><th>{t("board.006")}</th><th>{t("board.007")}</th></tr></thead>
                          <tbody>
                            {shown.map(([name, b]) => (
                              <tr key={name}>
                                <td style={{ fontWeight: 700 }}><ChampIcon name={name} />{champLabel(name)}</td>
                                <td>{b.games}</td>
                                <td style={{ color: theme.textSub }}>{b.wins}{t("board.010")}{b.games - b.wins}{t("board.011")}</td>
                                <td>{Math.round((b.wins / b.games) * 100)}%</td>
                                <td style={{ fontSize: 17, fontWeight: 700 }}>
                                  {b.kn ? `${(b.k / b.kn).toFixed(1)}/${(b.d / b.kn).toFixed(1)}/${(b.a / b.kn).toFixed(1)}` : "-"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {rows.length > 5 && (
                          <div style={{ marginBottom: 20 }}>
                            <button className="cs-btn-ghost" style={{ padding: "4px 14px", fontSize: 13 }}
                              onClick={() => setChampExpanded((v) => !v)}>
                              {champExpanded ? t("stats.028") : t("stats.029", { n: rows.length })}
                            </button>
                          </div>
                        )}
                        </>
                      );
                    })()}
                  </>
                )}

                {statsSubTab === "log" && (
                  <>
                    <div className="cs-scroll" style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                      {[["ALL", t("stats.034"), hist.length], ["WIN", t("stats.035"), hist.filter((h) => h.won).length], ["LOSE", t("stats.036"), hist.filter((h) => h.won === false).length]].map(([key, label, n]) => (
                        <button key={key} className="cs-btn-ghost"
                          style={{ padding: "6px 14px", fontSize: 14, whiteSpace: "nowrap",
                            borderColor: statsLogFilter === key ? theme.accent : theme.borderInput,
                            color: statsLogFilter === key ? theme.accent : theme.textSub,
                            fontWeight: statsLogFilter === key ? 700 : 400 }}
                          onClick={() => setStatsLogFilter(key)}>
                          {label} {n}
                        </button>
                      ))}
                      {logRoleChips.length > 1 && <span style={{ borderLeft: `1px solid ${theme.borderInput}`, margin: "2px 2px" }} />}
                      {logRoleChips.length > 1 && logRoleChips.map((r) => (
                        <button key={r.role} className="cs-btn-ghost"
                          style={{ padding: "6px 14px", fontSize: 14, whiteSpace: "nowrap",
                            borderColor: statsLogFilter === r.role ? theme.accent : theme.borderInput,
                            color: statsLogFilter === r.role ? theme.accent : theme.textSub,
                            fontWeight: statsLogFilter === r.role ? 700 : 400 }}
                          onClick={() => setStatsLogFilter(r.role)}>
                          {r.role} {r.games}
                        </button>
                      ))}
                    </div>
                    {logRows.length === 0 ? (
                      <EmptyState text={t("stats.015")} />
                    ) : (
                      <table className="cs-table">
                        <thead><tr><th>{t("shell.027")}</th><th>{t("stats.037")}</th><th>{t("shell.030")}</th><th>{t("shell.031")}</th><th>KDA</th><th>{t("shell.032")}</th><th>{t("stats.025")}</th></tr></thead>
                        <tbody>
                          {logRows.map((h, i) => (
                            <tr key={i}>
                              <td style={{ color: theme.textSub }}>{new Date(h.ts).toLocaleDateString(dateLocale())}</td>
                              <td style={{ color: h.side === "A" ? theme.accentBright : theme.teamB, fontWeight: 700 }}>{h.side ? sideLabel(h.side) : "-"}</td>
                              <td>{h.role}</td>
                              <td>{h.champion ? <><ChampIcon name={h.champion} />{champLabel(h.champion)}</> : "-"}</td>
                              <td style={{ fontSize: 17, fontWeight: 700 }}>{h.k != null ? `${h.k}/${h.d}/${h.a}` : "-"}</td>
                              <td style={{ color: h.won ? theme.accentBright : theme.teamB, fontWeight: 700 }}>{h.won ? t("shell.034") : t("shell.035")}</td>
                              <td style={{ fontWeight: 700, color: h.delta > 0 ? theme.accentBright : theme.teamB }}>
                                {h.delta != null ? `${h.delta > 0 ? "+" : ""}${h.delta.toFixed(1)}` : "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                )}
              </>
            );
          })()}
        </div>
        );
      })()}

      {/* ---------- BALANCE ---------- */}
      {tab === "balance" && (
        <div>
          {players.length < 2 ? (
            <EmptyState text={t("balance.001")} />
          ) : (
            <div>
            <div style={{ ...cardStyle, marginBottom: 16, borderColor: theme.accent, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 240px" }}>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{t("balance.002")}</div>
                <div style={{ fontSize: 13, color: theme.textSub }}>
                  {t("balance.003")}
                </div>
              </div>
              <button className="cs-btn" style={{ padding: "10px 20px", fontSize: 15 }} onClick={autoAssignAll}>
                {t("balance.004")}
              </button>
            </div>

            {/* 事前固定(レーン・対面): マッチング実行前に選手のチーム・レーンを固定する */}
            {(() => {
              const activePool = players.filter((p) => p.status !== "rest");
              const prefsMap = session.prefs || {};
              const locked = activePool.filter((p) => {
                const pf = prefsMap[p.id] || {};
                return (pf.team && pf.team !== "AUTO") || (pf.role && pf.role !== "AUTO");
              });
              const setLockPref = (id, patch) => setPref(id, patch);
              return (
                <div style={{ ...cardStyle, marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{t("balance.063")}</div>
                  <div style={{ fontSize: 13, color: theme.textSub, marginBottom: 10 }}>{t("balance.064")}</div>

                  {locked.length === 0 ? (
                    <div style={{ fontSize: 13, color: theme.textFaint, marginBottom: 10 }}>{t("balance.070")}</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                      {locked.map((p) => {
                        const pf = prefsMap[p.id] || {};
                        return (
                          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", borderBottom: `1px solid ${theme.borderTable}`, paddingBottom: 6 }}>
                            <span style={{ fontSize: 15, fontWeight: 700, minWidth: 80 }}>{p.name}</span>
                            <select className="cs-input" style={{ padding: "4px 6px", fontSize: 13 }} value={pf.team || "AUTO"}
                              onChange={(e) => setLockPref(p.id, { team: e.target.value })}>
                              <option value="AUTO">{t("balance.015")}</option>
                              <option value="A">{t("balance.016")}</option>
                              <option value="B">{t("balance.017")}</option>
                            </select>
                            <select className="cs-input" style={{ padding: "4px 6px", fontSize: 13 }} value={pf.role || "AUTO"}
                              onChange={(e) => setLockPref(p.id, { role: e.target.value })}>
                              <option value="AUTO">{t("balance.015")}</option>
                              {ROLES.filter((r) => !(p.ngRoles || []).includes(r)).map((r) => (
                                <option key={r} value={r}>{r}</option>
                              ))}
                            </select>
                            <button className="cs-btn-ghost" style={{ padding: "3px 10px", fontSize: 13, color: theme.teamB, borderColor: theme.teamB }}
                              onClick={() => setLockPref(p.id, { team: "AUTO", role: "AUTO" })}>
                              {t("balance.065")}
                            </button>
                            {(pf.team && pf.team !== "AUTO") && (pf.role && pf.role !== "AUTO") && (
                              <span style={{ fontSize: 12, color: theme.accent, fontWeight: 700 }}>{sideLabel(pf.team)} {pf.role}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 個別追加 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                    <select className="cs-input" style={{ padding: "4px 6px", fontSize: 13 }} value=""
                      onChange={(e) => { if (e.target.value) setLockPref(e.target.value, { team: "A" }); }}>
                      <option value="">{t("balance.066")}: {t("balance.069")}</option>
                      {activePool.filter((p) => !locked.some((l) => l.id === p.id)).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* 対面指定ショートカット+全解除 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <LaneMatchupSetter players={activePool} onSet={(xId, yId, role) => {
                      setPrefsBatch({ [xId]: { team: "A", role }, [yId]: { team: "B", role } });
                    }} />
                    {locked.length > 0 && (
                      <button className="cs-btn-ghost" style={{ padding: "5px 14px", fontSize: 13, color: theme.teamB, borderColor: theme.teamB, fontWeight: 700 }}
                        onClick={async () => {
                          if (!(await themedConfirm(t("balance.073")))) return;
                          const patches = {};
                          locked.forEach((p) => { patches[p.id] = { team: "AUTO", role: "AUTO" }; });
                          setPrefsBatch(patches);
                        }}>
                        {t("balance.072")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* 対面レート格差の警告しきい値(全端末共有・管理者PASSで変更) */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: theme.textSub, marginBottom: 16 }}>
              <span>{t("balance.079", { v: matchupThreshold })}</span>
              <button className="cs-btn-ghost" style={{ padding: "3px 10px", fontSize: 13 }} onClick={editMatchupThreshold}>
                {t("balance.083")}
              </button>
            </div>

            {/* 対面レート格差の警告バナー: 2カラムの狭い右側ではなく全幅で表示する(折り返し防止) */}
            {matchupWarnings.length > 0 && (
              <div className="cs-prose" style={{ border: `1px solid ${theme.teamB}`, background: theme.surfaceAlt, borderRadius: 6, padding: 10, marginBottom: 16, fontSize: 13 }}>
                <div style={{ color: theme.teamB, fontWeight: 700, marginBottom: 4 }}>
                  {t("balance.077", { n: matchupWarnings.length, th: matchupThreshold })}
                </div>
                {matchupWarnings.map((g) => (
                  <div key={g.role} style={{ color: theme.text, whiteSpace: "nowrap", overflowX: "auto" }}>
                    {t("balance.074", { role: g.role, hi: g.hiName, lo: g.loName, hiMu: g.hiMu.toFixed(1), loMu: g.loMu.toFixed(1), diff: g.diff.toFixed(1) })}
                  </div>
                ))}
                <div style={{ color: theme.textSub, marginTop: 4 }}>{t("balance.076")}</div>
              </div>
            )}

            <div className="cs-side-narrow">
              {/* 左: 本日の参加者(セッション共有・全員の画面で同期) */}
              <div style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>{t("balance.005")}</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="cs-btn-ghost" style={{ padding: "7px 16px", fontSize: 14, fontWeight: 700, color: theme.teamB, borderColor: theme.teamB, borderWidth: 2 }} title={t("balance.006")} onClick={resetTodayCount}>{t("balance.007")}</button>
                    {session.roster.length > 0 && (
                      <button className="cs-btn-ghost" style={{ padding: "7px 16px", fontSize: 14, fontWeight: 700, color: theme.teamB, borderColor: theme.teamB, borderWidth: 2 }} onClick={clearRoster}>{t("balance.008")}</button>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {players.filter((p) => p.status !== "rest").map((p) => {
                    const on = session.roster.includes(p.id);
                    const tc = todayCounts[p.id] || 0;
                    const adj = !!p.adjust;
                    return (
                      <button key={p.id} onClick={() => toggleRoster(p.id)} className="cs-btn-ghost"
                        style={{
                          borderColor: on ? theme.accent : theme.borderInput,
                          borderStyle: adj ? "dashed" : "solid",
                          color: on ? theme.accent : theme.textSub, padding: "6px 12px", fontWeight: on ? 700 : 500,
                        }}>
                        {p.name}{adj && <span style={{ fontSize: 11, color: theme.accent, marginLeft: 3 }}>{t("stats.007")}</span>}{tc > 0 && <span style={{ fontSize: 12, color: theme.textFaint, marginLeft: 4 }}>{t("balance.053", { n: tc })}</span>}
                      </button>
                    );
                  })}
                </div>

                {session.roster.length > 0 && (
                  <div style={{ fontSize: 13, color: theme.textFaint, marginBottom: 12, lineHeight: 1.7 }}>
                    {t("balance.056", { n: Math.min(10, session.roster.length) })}
                    {seating.overflow && <span style={{ color: theme.teamB }}> {t("balance.012")}</span>}
                  </div>
                )}

                {session.roster.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                    <label style={labelStyle}>{t("balance.013")}{seating.seatedIds.length}{t("balance.014")}</label>
                    {seating.seatedIds.map((id) => {
                      const p = players.find((x) => x.id === id);
                      if (!p) return null;
                      const pref = (session.prefs || {})[id] || { team: "AUTO" };
                      const wants = p.prefRoles || [];
                      return (
                        <div key={id} style={{ borderBottom: `1px solid ${theme.borderTable}`, paddingBottom: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 15, fontWeight: 700, minWidth: 80 }}>{p.name}</span>
                            <select className="cs-input" style={{ padding: "4px 6px", fontSize: 13 }} value={pref.team}
                              onChange={(e) => setPref(id, { team: e.target.value })}>
                              <option value="AUTO">{t("balance.015")}</option>
                              <option value="A">{t("balance.016")}</option>
                              <option value="B">{t("balance.017")}</option>
                            </select>
                            <button className="cs-btn-ghost" style={{ padding: "3px 8px", fontSize: 13, color: theme.teamB, borderColor: theme.teamB }}
                              onClick={() => setPref(id, { force: "bench" })}>
                              {t("balance.018")}
                            </button>
                          </div>
                          <div style={{ fontSize: 13, color: theme.textFaint }}>
                            {t("balance.019")} {wants.length ? wants.join(" / ") : t("balance.020")}
                            <span style={{ marginLeft: 6, fontSize: 11.5 }}>{t("balance.021")}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {seating.benchIds.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>{t("balance.022")}{seating.benchIds.length}{t("balance.023")}</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {seating.benchIds.map((id) => {
                        const p = players.find((x) => x.id === id);
                        if (!p) return null;
                        return (
                          <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${theme.borderInput}`, borderRadius: 6, padding: "4px 10px", fontSize: 14, color: theme.textSub }}>
                            {p.name}
                            <button className="cs-btn-ghost" style={{ padding: "2px 6px", fontSize: 11.5 }} onClick={() => setPref(id, { force: "seat" })}>{t("balance.024")}</button>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                <button className="cs-btn" style={{ width: "100%" }} disabled={filledCount < 2 || filledCount > 10} onClick={runBalance}>
                  {t("balance.055", { n: filledCount })}
                </button>
                {filledCount > 10 && <div style={{ fontSize: 13, color: theme.teamB, marginTop: 6 }}>{t("balance.026")}</div>}
              </div>

              {/* 右: 結果 */}
              <div style={{ minWidth: 0 }}>
                {balanceResult === undefined && <EmptyState text={t("balance.027")} />}
                {balanceResult === null && (
                  <EmptyState text={t("balance.028")} />
                )}
                {balanceResult && (() => {
                  const liveNgCount = [...balanceResult.teamA, ...balanceResult.teamB].filter((bp) => {
                    const p = players.find((x) => x.id === bp.id);
                    return !!(p?.ngRoles || []).includes(bp.role);
                  }).length;
                  return (
                  <>
                    <div style={{ fontSize: 13, color: theme.textSub, marginBottom: 8 }}>
                      {t("balance.029")}
                      {balanceResult.manual && <span style={{ color: theme.accent, fontWeight: 700, marginLeft: 6 }}>{t("balance.030")}</span>}
                    </div>
                    {liveNgCount > 0 && (
                      <div style={{ ...cardStyle, borderColor: theme.teamB, marginBottom: 12, color: theme.teamB, fontSize: 13, fontWeight: 700 }}>
                        {t("balance.031")}{liveNgCount}{t("balance.032")}
                      </div>
                    )}
                    {swapSel && (
                      <div style={{ marginBottom: 12 }}>
                        <button className="cs-btn" style={{ fontSize: 14, padding: "8px 18px" }} onClick={() => setSubPickerOpen(true)}>
                          {t("balance.059")}
                        </button>
                      </div>
                    )}
                    {swapSel && subPickerOpen && (() => {
                      const inTeamIds = new Set([...balanceResult.teamA, ...balanceResult.teamB].map((x) => x.id));
                      const candidates = players.filter((p) => !inTeamIds.has(p.id) && p.status !== "rest");
                      const slot = (swapSel.team === "A" ? balanceResult.teamA : balanceResult.teamB)[swapSel.idx];
                      return (
                        <div onClick={() => setSubPickerOpen(false)}
                          style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                          <div onClick={(e) => e.stopPropagation()}
                            style={{ ...cardStyle, background: theme.surface, width: "min(560px, 96vw)", maxHeight: "80vh", overflowY: "auto", padding: 22, boxShadow: "0 8px 40px rgba(0,0,0,.4)" }}>
                            <div style={{ fontSize: 19, fontWeight: 700, color: theme.accent, marginBottom: 4 }}>{t("balance.059")}</div>
                            <div style={{ fontSize: 14, color: theme.textSub, marginBottom: 14 }}>
                              {slot ? `${slot.role} / ${slot.name}` : ""} → {t("balance.060")}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                              {candidates.length === 0 ? (
                                <span style={{ fontSize: 14, color: theme.textFaint }}>-</span>
                              ) : candidates.map((p) => {
                                const ng = slot && (p.ngRoles || []).includes(slot.role);
                                return (
                                  <button key={p.id} className="cs-btn-ghost" disabled={ng}
                                    style={{ padding: "10px 18px", fontSize: 16, fontWeight: 700, opacity: ng ? 0.4 : 1,
                                      borderColor: ng ? theme.borderInput : theme.accent }}
                                    onClick={() => handleSubstitute(p.id)}>
                                    {p.name}{ng ? " (NG)" : ""}
                                  </button>
                                );
                              })}
                            </div>
                            <div style={{ marginTop: 18, textAlign: "right" }}>
                              <button className="cs-btn-ghost" style={{ padding: "8px 20px", fontSize: 14 }} onClick={() => setSubPickerOpen(false)}>
                                {t("balance.071")}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    <div ref={balanceCardRef} style={{ background: theme.surface, padding: 4 }}>
                    <div className="cs-cols2">
                      {["A", "B"].map((side) => {
                        const color = side === "A" ? theme.accentBright : theme.teamB;
                        const list = side === "A" ? balanceResult.teamA : balanceResult.teamB;
                        return (
                          <div key={side} style={{ ...cardStyle, borderColor: color }}>
                            <div style={{ color, fontWeight: 700, marginBottom: 10, fontSize: 16 }}>
                              {sideLabel(side)} <span style={{ fontWeight: 400, color: theme.textFaint, fontSize: 14 }}>{t("balance.033")}{list.reduce((s, x) => s + x.mu, 0).toFixed(1)}</span>
                            </div>
                            {list.map((bp, idx) => {
                              const p = players.find((x) => x.id === bp.id);
                              const total = p ? p.wins + p.losses : 0;
                              const wr = total ? Math.round((p.wins / total) * 100) : null;
                              const selected = swapSel && swapSel.team === side && swapSel.idx === idx;

                              // このロールでのチャンピオン別勝率を集計し、最高勝率(同率は試合数が多い方)を採用
                              const roleHist = (p?.kdaHistory || []).filter((h) => h.role === bp.role && h.champion);
                              const byChamp = {};
                              roleHist.forEach((h) => {
                                if (!byChamp[h.champion]) byChamp[h.champion] = { games: 0, wins: 0, k: 0, d: 0, a: 0, kn: 0 };
                                const b = byChamp[h.champion];
                                b.games++; if (h.won) b.wins++;
                                if (h.k != null || h.d != null || h.a != null) { b.k += h.k || 0; b.d += h.d || 0; b.a += h.a || 0; b.kn++; }
                              });
                              const bestChamp = Object.entries(byChamp)
                                .sort((x, y) => (y[1].wins / y[1].games) - (x[1].wins / x[1].games) || y[1].games - x[1].games)[0];

                              const link = opggUrl(p?.summonerName);
                              // 表示は保存済みスナップショット(bp.wanted/bp.isNg、編成生成時点の値)ではなく、
                              // 現在の選手データから毎回ライブ計算する。編成後に本人が希望/NG設定を変更した場合、
                              // 古い判定のまま表示され続けるのを防ぐため。
                              const liveWanted = !!(p?.prefRoles || []).includes(bp.role);
                              const liveNg = !!(p?.ngRoles || []).includes(bp.role);
                              const gapWarn = matchupWarnings.find((w) => w.role === bp.role) || null;
                              return (
                                <div key={idx} onClick={() => handleSlotTap(side, idx)} style={{
                                  padding: "8px 8px", borderBottom: `1px solid ${theme.borderTable}`, cursor: "pointer", borderRadius: 6,
                                  background: selected ? theme.surfaceAlt : "transparent",
                                  outline: selected ? `2px solid ${theme.accent}` : liveNg ? `1px solid ${theme.teamB}` : "none",
                                  borderLeft: gapWarn ? `3px solid ${theme.teamB}` : "3px solid transparent",
                                }}>
                                  <div>
                                    <b style={{ color: theme.accent }}>{bp.role}</b> <b style={{ color: theme.text }}>{bp.name}</b>
                                    <span style={{ color: theme.textFaint, fontSize: 14 }}> ({bp.mu.toFixed(1)})</span>
                                    {liveWanted && <span title={t("balance.034")} style={{ color: theme.accent, marginLeft: 4 }}>★</span>}
                                    {liveNg && <span title={t("balance.035")} style={{ color: theme.teamB, marginLeft: 4, fontWeight: 700 }}>⚠ NG</span>}
                                    {gapWarn && <span title={t("balance.076")} style={{ color: theme.teamB, fontWeight: 700, fontSize: 13, marginLeft: 6 }}>⚠ {t("balance.078", { diff: gapWarn.diff.toFixed(1) })}</span>}
                                    {p?.summonerName && (
                                      // カスタム招待でそのまま貼れるよう、Riot IDをタップでクリップボードにコピーできるようにする
                                      <span onClick={(ev) => {
                                        ev.stopPropagation();
                                        try {
                                          navigator.clipboard.writeText(p.summonerName);
                                          setCopiedRiotId(p.id);
                                          setTimeout(() => setCopiedRiotId((cur) => (cur === p.id ? null : cur)), 1500);
                                        } catch { /* クリップボード非対応環境では何もしない */ }
                                      }}
                                        title={p.summonerName}
                                        style={{ color: theme.textSub, fontSize: 13, marginLeft: 8, cursor: "pointer", textDecoration: "underline dotted", fontWeight: 400 }}>
                                        {p.summonerName}
                                      </span>
                                    )}
                                    {copiedRiotId === p?.id && (
                                      <span style={{ color: theme.accentBright, fontSize: 12, marginLeft: 6, fontWeight: 700 }}>{t("scoutMulti.020")}</span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 14, color: theme.text, marginTop: 3, fontWeight: 700 }}>
                                    {t("balance.036")} <b style={{ color: wr == null ? theme.textFaint : wr >= 50 ? theme.accentBright : theme.teamB }}>
                                      {wr == null ? t("stats.015") : `${wr}%`}
                                    </b>
                                    {total > 0 && <span style={{ color: theme.textSub, fontWeight: 400 }}>{t("balance.054", { total, w: p.wins, l: p.losses })}</span>}
                                    {link && (
                                      <a href={link} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: 3, color: theme.accentBright, marginLeft: 10, fontWeight: 700 }}>
                                        <ExternalLink size={14} />{t("scoutMulti.002")}
                                      </a>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 14, color: theme.text, marginTop: 3, fontWeight: 700 }}>
                                    {bp.role}{t("balance.038")}{" "}
                                    {bestChamp ? (
                                      <>
                                        <ChampIcon name={bestChamp[0]} size={16} />
                                        <b style={{ color: theme.text }}>{champLabel(bestChamp[0])}</b>
                                        <span style={{ color: theme.textSub, fontWeight: 400 }}>
                                          {t("balance.039")}{" "}
                                          <b style={{ color: theme.accentBright, fontWeight: 700 }}>{Math.round((bestChamp[1].wins / bestChamp[1].games) * 100)}%</b>
                                          {bestChamp[1].kn > 0 && ` KDA: ${(bestChamp[1].k / bestChamp[1].kn).toFixed(1)}/${(bestChamp[1].d / bestChamp[1].kn).toFixed(1)}/${(bestChamp[1].a / bestChamp[1].kn).toFixed(1)}`}）
                                        </span>
                                      </>
                                    ) : <span style={{ color: theme.textFaint, fontWeight: 400 }}>{t("stats.015")}</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>

                    {/* バン保護枠: チーム単位(ブルー/レッド)でチャンピオンを宣言。個々の選手には紐づけない */}
                    <div style={{ ...cardStyle, marginTop: 16 }}>
                      <datalist id="champListBan">
                        {[...(ddChamps ? ddChamps.map((x) => x.name) : CHAMPIONS), ...customChamps].map((ch) => <option key={ch} value={champLabel(ch)} />)}
                      </datalist>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t("balance.040")}</div>
                      <div style={{ fontSize: 13, color: theme.textFaint, marginBottom: 10 }}>
                        {t("balance.041")}
                      </div>
                      <div className="cs-cols2">
                        {["A", "B"].map((side) => {
                          const color = side === "A" ? theme.accentBright : theme.teamB;
                          const list = (balanceResult.banProtect || { A: [], B: [] })[side] || [];
                          return (
                            <div key={side}>
                              <div style={{ color, fontWeight: 700, marginBottom: 6, fontSize: 14 }}>{sideLabel(side)}</div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, minHeight: 26 }}>
                                {list.length === 0 && <span style={{ fontSize: 13, color: theme.textFaint }}>{t("balance.042")}</span>}
                                {list.map((champ) => (
                                  <span key={champ} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: theme.surfaceAlt, border: `1px solid ${theme.borderInput}`, borderRadius: 5, padding: "3px 8px", fontSize: 13 }}>
                                    <ChampIcon name={champ} size={16} />{champLabel(champ)}
                                    <X size={13} style={{ cursor: "pointer", color: theme.textFaint }} onClick={() => removeBanProtect(side, champ)} />
                                  </span>
                                ))}
                              </div>
                              <div style={{ display: "flex", gap: 6 }}>
                                <input className="cs-input" list="champListBan" style={{ flex: 1, minWidth: 0, padding: "5px 8px", fontSize: 13 }}
                                  placeholder={t("balance.043")} value={banInput[side]}
                                  onChange={(e) => setBanInput({ ...banInput, [side]: e.target.value })}
                                  onKeyDown={(e) => { if (e.key === "Enter") { addBanProtect(side, banInput[side]); setBanInput({ ...banInput, [side]: "" }); } }} />
                                <button className="cs-btn-ghost" style={{ padding: "5px 12px", fontSize: 13 }}
                                  onClick={() => { addBanProtect(side, banInput[side]); setBanInput({ ...banInput, [side]: "" }); }}>{t("balance.044")}</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    </div>

                    <div style={{ fontSize: 13, color: theme.textFaint, marginTop: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span>{t("balance.045")} {balanceResult.diff.toFixed(1)} {t("balance.046")} {balanceResult.laneDiff.toFixed(1)}</span>
                      <button className="cs-btn-ghost" title={t("balance.084")}
                        style={{ padding: "1px 8px", fontSize: 13, lineHeight: 1.5, fontWeight: 700 }}
                        onClick={() => themedAlert([
                          t("balance.084"), "",
                          t("balance.085"), "",
                          t("balance.086"), "",
                          t("balance.087"),
                          t("balance.088"), "",
                          t("balance.089"), "",
                          t("balance.090"),
                        ].join("\n"))}>
                        ?
                      </button>
                    </div>
                    <button className="cs-btn-ghost" style={{ marginTop: 12, marginRight: 8 }}
                      onClick={async () => {
                        const line = (p) => `${p.role.padEnd(3)} ${p.name}`;
                        const bp = balanceResult.banProtect || { A: [], B: [] };
                        const banLines = [];
                        if (bp.A?.length) banLines.push(`ブルー: ${bp.A.join("、")}`);
                        if (bp.B?.length) banLines.push(`レッド: ${bp.B.join("、")}`);
                        const txt = [
                          "【チーム分け】",
                          `■ ブルーサイド（計${balanceResult.teamA.reduce((s, x) => s + x.mu, 0).toFixed(0)}）`,
                          ...balanceResult.teamA.map(line),
                          `■ レッドサイド（計${balanceResult.teamB.reduce((s, x) => s + x.mu, 0).toFixed(0)}）`,
                          ...balanceResult.teamB.map(line),
                          `レート差: ${balanceResult.diff.toFixed(1)}`,
                          ...(banLines.length ? ["", "── バン保護 ──", ...banLines] : []),
                        ].join("\n");
                        try { await navigator.clipboard.writeText(txt); themedAlert(t("balance.047")); }
                        catch { await themedPrompt(t("balance.048"), { defaultValue: txt }); }
                      }}>
                      {t("balance.049")}
                    </button>
                    <button className="cs-btn-ghost" style={{ marginTop: 12, marginRight: 8 }} disabled={imgCopyBusy}
                      onClick={() => copyBalanceImage(balanceCardRef.current)}>
                      {imgCopyBusy ? t("balance.050") : t("balance.051")}
                    </button>
                    <button className="cs-btn" style={{ marginTop: 12 }}
                      onClick={() => {
                        setEntries([
                          ...balanceResult.teamA.map((p) => ({ playerId: p.id, team: "A", role: p.role, champion: "" })),
                          ...balanceResult.teamB.map((p) => ({ playerId: p.id, team: "B", role: p.role, champion: "" })),
                        ]);
                        setKdaInputs({});
                        setTab("report");
                      }}>
                      {t("balance.052")}
                    </button>
                  </>
                  );
                })()}
              </div>
            </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- ATTENDANCE BOARD(出欠ボード) ---------- */}
      {tab === "attendance" && (() => {
        if (players.length === 0) return <EmptyState text={t("stats.002")} />;
        const myPlayer = players.find((p) => p.id === myPlayerId) || null;

        const bucketOf = (p) => (isStaleResponse(p) ? "noResponse" : p.status === "rest" ? "rest" : p.adjust ? "adjust" : "active");
        const buckets = { active: [], adjust: [], rest: [], noResponse: [] };
        players.forEach((p) => buckets[bucketOf(p)].push(p));

        // 編成見込み: 参加中のみを母数に、10人単位で試合成立数を判定
        const activeCount = buckets.active.length;
        const matchesPossible = Math.floor(activeCount / 10);
        const remainder = activeCount % 10;
        const need = matchesPossible >= 1 ? matchesPossible * 2 : 0;
        // ロール別の希望/可・過不足はヒューリスティック: 必要数との差が0=ちょうど、マイナス=不足、
        // +1〜2=余裕、+3以上=過多として大まかに区分する(細かい調整は運用しながら見直す想定)
        const roleForecast = ROLES.map((r) => {
          const want = buckets.active.filter((p) => (p.prefRoles || []).includes(r)).length;
          const can = buckets.active.filter((p) => !(p.ngRoles || []).includes(r)).length;
          const diff = want - need;
          const status = need === 0 ? null : diff < 0 ? "short" : diff === 0 ? "exact" : diff <= 2 ? "surplus" : "over";
          return { role: r, want, can, diff, status };
        });

        const timeLabel = (p) => {
          if (p.availFrom && p.availTo) return t("attend.032", { from: p.availFrom, to: p.availTo });
          if (p.availFrom) return t("attend.033", { from: p.availFrom });
          if (p.availTo) return t("attend.034", { to: p.availTo });
          return t("attend.031");
        };
        const respondLabel = (p) => {
          if (!p.respondedAt) return t("attend.037");
          const days = Math.floor((Date.now() - p.respondedAt) / 86400000);
          return days < 7 ? t("attend.035", { n: days }) : t("attend.036", { n: Math.floor(days / 7) });
        };
        const orderMeFirst = (arr) => [...arr].sort((a, b) => (a.id === myPlayerId ? -1 : b.id === myPlayerId ? 1 : 0));
        // 右側の補足テキスト: 参加中/調整枠は時間(+メモがあれば併記)、休みはメモのみ、未回答は未応答日数
        const rightText = (p, colKey) => {
          if (colKey === "noResponse") return respondLabel(p);
          if (colKey === "rest") return p.memo || "";
          return p.memo ? `${timeLabel(p)} / ${p.memo}` : timeLabel(p);
        };
        const renderCard = (p, colKey) => (
          <div key={p.id} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
            padding: "6px 8px", borderRadius: 6, background: theme.surfaceWhite,
            border: `1px solid ${p.id === myPlayerId ? theme.accent : theme.borderInput}`,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                onClick={() => { setStatsPlayerId(p.id); setTab("stats"); }} title={p.name}>
                {p.name}
              </div>
              <div style={{ fontSize: 11.5, color: theme.textFaint }}>
                {(p.prefRoles || []).length ? p.prefRoles.map((r) => `★${r}`).join(" ") : "-"}
              </div>
            </div>
            <div className="cs-prose" style={{ fontSize: 12, color: theme.textSub, textAlign: "right" }}>
              {rightText(p, colKey)}
            </div>
          </div>
        );
        const COLS = [
          { key: "active", label: t("attend.015"), color: theme.accentBright },
          { key: "adjust", label: t("queue.003"), color: theme.accent },
          { key: "rest", label: t("players.028"), color: theme.textSub },
          { key: "noResponse", label: t("attend.037"), color: theme.teamB },
        ];

        return (
          <div>
            {(!myPlayerId || myPickerOpen) ? (
              <div style={{ ...cardStyle, marginBottom: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("attend.029")}</div>
                <input className="cs-input" style={{ width: "100%", marginBottom: 10, boxSizing: "border-box" }} placeholder={t("attend.040")}
                  value={myPickerSearch} onChange={(e) => setMyPickerSearch(e.target.value)} />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, maxHeight: 280, overflowY: "auto" }}>
                  {[...players].sort((a, b) => a.name.localeCompare(b.name, "ja"))
                    .filter((p) => p.name.includes(myPickerSearch.trim()))
                    .map((p) => (
                      <div key={p.id} onClick={() => chooseMyPlayer(p.id)}
                        style={{
                          cursor: "pointer", padding: "8px 10px", borderRadius: 6,
                          border: `1px solid ${p.id === myPlayerId ? theme.accentBright : theme.borderInput}`,
                          background: p.id === myPlayerId ? theme.surfaceAlt : theme.surfaceWhite,
                        }}>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div>
                        <div style={{ fontSize: 13, color: theme.textFaint }}>{rankLabel(p.rank)}</div>
                      </div>
                    ))}
                </div>
              </div>
            ) : myPlayer && (
              <div style={{ ...cardStyle, marginBottom: 16, borderColor: theme.accent, borderWidth: 2 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: theme.accent }}>{t("attend.017")}</div>
                    <div style={{ fontSize: 13, color: theme.textFaint }}>{t("attend.018")}</div>
                  </div>
                  <div style={{ fontSize: 13, color: theme.textFaint }}>
                    {myPlayer.respondedAt && t("attend.019", { time: new Date(myPlayer.respondedAt).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" }) })}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 17 }}>{myPlayer.name}</div>
                    <div style={{ fontSize: 13, color: theme.textSub }}>{rankLabel(myPlayer.rank)} ・ {t("stats.004")} {myPlayer.wins}{t("board.010")}{myPlayer.losses}{t("board.011")}</div>
                  </div>
                  <button className="cs-btn-ghost" style={{ padding: "3px 10px", fontSize: 13, marginLeft: "auto" }} onClick={() => setMyPickerOpen(true)}>{t("attend.030")}</button>
                </div>

                <div style={{ fontSize: 13, color: theme.textSub, marginBottom: 6, fontWeight: 700 }}>{t("attend.025")}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 130px))", gap: 6, marginBottom: 6 }}>
                  {ROLES.map((r) => {
                    const wanted = (myPlayer.prefRoles || []).includes(r);
                    const isNg = (myPlayer.ngRoles || []).includes(r);
                    return (
                      <div key={r} onClick={() => cyclePrefRole(myPlayer.id, r)}
                        style={{
                          cursor: "pointer", textAlign: "center", padding: "8px 4px", borderRadius: 6,
                          background: isNg ? theme.teamB : wanted ? theme.accent : theme.surfaceAlt,
                          color: isNg || wanted ? "#FFF8EC" : theme.text,
                        }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{r}{wanted && " ★"}{isNg && " ✕"}</div>
                        <div style={{ fontSize: 17, fontWeight: 700 }}>{myPlayer.roles[r].mu.toFixed(1)}</div>
                        <div style={{ fontSize: 11, opacity: 0.85 }}>{t("board.019")}<ProfBadge prof={myPlayer.roles[r].prof} /></div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11.5, color: theme.textFaint, marginBottom: 14 }}>{t("attend.026")}</div>

                <div style={{ fontSize: 13, color: theme.textSub, marginBottom: 6, fontWeight: 700 }}>{t("attend.020")}</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                  {[
                    ["active", t("attend.021"), t("attend.022")],
                    ["adjust", t("queue.003"), t("attend.023")],
                    ["rest", t("players.028"), t("attend.024")],
                  ].map(([mode, label, sub]) => {
                    const on = mode === "rest" ? myPlayer.status === "rest" : mode === "adjust" ? myPlayer.adjust : (myPlayer.status !== "rest" && !myPlayer.adjust);
                    return (
                      <button key={mode} onClick={() => setParticipation(myPlayer.id, mode)}
                        style={{
                          flex: "1 1 120px", textAlign: "left", padding: "8px 12px", borderRadius: 8, cursor: "pointer",
                          border: `2px solid ${on ? theme.accent : theme.borderInput}`,
                          background: on ? theme.surfaceAlt : theme.surfaceWhite,
                        }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: on ? theme.accent : theme.text }}>{label}</div>
                        <div style={{ fontSize: 11.5, color: theme.textFaint }}>{sub}</div>
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div>
                    <div style={{ fontSize: 12, color: theme.textFaint, marginBottom: 3 }}>{t("attend.027")}</div>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input className="cs-input" style={{ width: 90 }} placeholder="21:30" value={selfForm.from} onChange={(e) => setSelfForm({ ...selfForm, from: e.target.value })} />
                      <span>〜</span>
                      <input className="cs-input" style={{ width: 90 }} placeholder="24:00" value={selfForm.to} onChange={(e) => setSelfForm({ ...selfForm, to: e.target.value })} />
                    </div>
                  </div>
                  <input className="cs-input" style={{ flex: "1 1 220px" }} placeholder={t("attend.028")} value={selfForm.memo} onChange={(e) => setSelfForm({ ...selfForm, memo: e.target.value })} />
                  <button className="cs-btn" style={{ padding: "8px 20px" }} onClick={() => saveMyAvailability(myPlayer.id, selfForm)}>{t("misc.003")}</button>
                </div>
              </div>
            )}

            <div style={{ ...cardStyle, marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: theme.textSub, marginBottom: 4 }}>{t("attend.001")}</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
                {matchesPossible >= 1 ? t("attend.002", { n: activeCount, m: matchesPossible }) : t("attend.003", { n: activeCount })}
              </div>
              {matchesPossible >= 1 && (buckets.adjust.length > 0 || remainder > 0) && (
                <div style={{ fontSize: 13, color: theme.textFaint, marginBottom: 14 }}>
                  {buckets.adjust.length > 0 && t("attend.004", { n: buckets.adjust.length })}
                  {remainder > 0 && t("attend.005", { n: 10 - remainder })}
                </div>
              )}
              {need > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 260px))", gap: 14 }}>
                  {roleForecast.map((r) => {
                    const statusLabel = r.status === "short" ? t("attend.009") : r.status === "exact" ? t("attend.008") : r.status === "over" ? t("attend.007") : t("attend.006");
                    const barColor = r.status === "short" ? theme.teamB : r.status === "over" ? theme.accent : theme.accentBright;
                    const pct = Math.min(100, (r.want / Math.max(r.can, 1)) * 100);
                    return (
                      <div key={r.role}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 2 }}>
                          <span style={{ fontWeight: 700 }}>{r.role}</span>
                          <span style={{ fontWeight: 700, color: barColor }}>{statusLabel}{r.status === "short" ? ` ${r.diff}` : ""}</span>
                        </div>
                        <div style={{ height: 8, borderRadius: 4, background: theme.borderTable, overflow: "hidden", marginBottom: 2 }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: barColor }} />
                        </div>
                        <div style={{ fontSize: 11.5, color: theme.textFaint }}>{t("attend.010", { want: r.want, can: r.can })}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <div>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{t("attend.011", { n: players.length })}</span>
                <span style={{ fontSize: 13, color: theme.textFaint, marginLeft: 10 }}>{t("attend.012")}</span>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="cs-btn-ghost" style={{ padding: "4px 12px", fontSize: 13 }} onClick={() => setTab("playerList")}>{t("attend.014")}</button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
              {COLS.map((col) => {
                const arr = orderMeFirst(buckets[col.key]);
                const shown = attendExpanded[col.key] ? arr : arr.slice(0, 6);
                return (
                  <div key={col.key} style={{ ...cardStyle, padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, paddingBottom: 6, borderBottom: `2px solid ${col.color}` }}>
                      <span style={{ fontWeight: 700, color: col.color }}>{col.label}</span>
                      <span style={{ fontWeight: 700, color: col.color }}>{arr.length}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {shown.length === 0 ? <span style={{ fontSize: 13, color: theme.faintAccent }}>-</span> : shown.map((p) => renderCard(p, col.key))}
                    </div>
                    {arr.length > 6 && !attendExpanded[col.key] && (
                      <button className="cs-btn-ghost" style={{ marginTop: 8, padding: "3px 10px", fontSize: 13, width: "100%" }}
                        onClick={() => setAttendExpanded({ ...attendExpanded, [col.key]: true })}>
                        {t("attend.016", { n: arr.length - 6 })}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ---------- PLAYERS ---------- */}
      {tab === "queue" && (
        <div>
          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>{t("queue.001")}</label>
              <button className="cs-btn-ghost" style={{ padding: "3px 10px", fontSize: 13 }} title={t("balance.006")} onClick={resetTodayCount}>{t("balance.007")}</button>
            </div>
            {activePlayersByQueue.length === 0 ? (
              <div style={{ fontSize: 13, color: theme.textFaint }}>{t("queue.002")}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {activePlayersByQueue.map((p, i) => {
                  const seatCandidate = initialSeatIds.has(p.id);
                  return (
                    <div key={p.id} style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 4,
                      background: seatCandidate ? "rgba(217,143,50,0.08)" : "transparent",
                    }}>
                      <span style={{ fontSize: 13, color: seatCandidate ? theme.accentBright : theme.textFaint, fontWeight: 700, width: 22, textAlign: "right" }}>{i + 1}</span>
                      <span style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }} title={p.name}>
                        {p.name}{p.adjust && <span style={{ fontSize: 11.5, color: theme.accent, marginLeft: 5 }}>{t("queue.003")}</span>}
                      </span>
                      <span style={{ fontSize: 13, color: theme.textSub, flexShrink: 0 }}>{t("balance.009")} {todayCounts[p.id] || 0} {t("scoutMulti.006")}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ fontSize: 12, color: theme.textFaint, marginTop: 8 }}>
              {t("queue.004")}
            </div>
          </div>
        </div>
      )}

      {tab === "playerRegister" && (
        <div style={{ maxWidth: 900 }}>
          <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${theme.borderTable}` }}>
              <span style={{ fontSize: 19, fontWeight: 700 }}>{t("players.001")}</span>
              <X size={20} style={{ cursor: "pointer", color: theme.textFaint }} onClick={resetNewPlayerForm} />
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 420px))", gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={{ ...labelStyle, fontSize: 14 }}>{t("players.002")}</label>
                  <input className="cs-input" style={{ width: "100%", boxSizing: "border-box" }} placeholder={t("players.070")}
                    value={newPlayerName} onChange={(e) => setNewPlayerName(e.target.value)} />
                </div>
                <div>
                  <label style={{ ...labelStyle, fontSize: 14 }}>{t("players.003")}</label>
                  <input className="cs-input" style={{ width: "100%", boxSizing: "border-box" }} placeholder={t("players.003")}
                    value={newSummoner} onChange={(e) => setNewSummoner(e.target.value)} />
                  <div style={{ fontSize: 11.5, color: theme.textFaint, marginTop: 4 }}>{t("players.004")}</div>
                </div>
              </div>

              <div className="cs-reg-split" style={{ marginBottom: 6 }}>
                <div>
                  <label style={{ ...labelStyle, fontSize: 14 }}>{t("players.005")}</label>
                  <select className="cs-input" style={{ width: "100%" }} value={newRank} onChange={(e) => setNewRank(e.target.value)}>
                    {RANKS.map(([label, mu]) => <option key={label} value={label}>{rankLabel(label)} ({mu}pt)</option>)}
                  </select>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
                    <label style={{ ...labelStyle, fontSize: 14, marginBottom: 6 }}>{t("players.066")}</label>
                    <span style={{ fontSize: 11.5, color: theme.textFaint }}>{t("players.006")}（◎1.00 〇0.92 △0.85 ×0.75）</span>
                  </div>
                  <div className="cs-reg-roles">
                    {ROLES.map((r) => {
                      const baseMu = RANKS.find(([label]) => label === newRank)?.[1] ?? MU0;
                      const pt = Math.round(baseMu * PROF_RATE[newProfs[r]] * 10) / 10;
                      return (
                        <div key={r} style={{ border: `1px solid ${theme.borderInput}`, borderRadius: 8, padding: "8px 2px", textAlign: "center", minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: theme.textSub, marginBottom: 6 }}>{r}</div>
                          <div style={{ display: "flex", justifyContent: "center", gap: 3, marginBottom: 6 }}>
                            {PROFS.map((pf) => (
                              <button key={pf} onClick={() => setNewProfs({ ...newProfs, [r]: pf })}
                                style={{
                                  width: 22, height: 22, borderRadius: "50%", border: `1px solid ${theme.borderInput}`, padding: 0, flexShrink: 0,
                                  background: newProfs[r] === pf ? theme.accent : theme.surfaceWhite,
                                  color: newProfs[r] === pf ? "#FFF8EC" : theme.textSub,
                                  fontSize: 12, cursor: "pointer", lineHeight: 1,
                                }}>
                                {pf}
                              </button>
                            ))}
                          </div>
                          <div style={{ fontSize: 12, color: theme.textFaint }}>{pt}pt</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 12, color: theme.textFaint, marginBottom: 16 }}>{t("players.007")}</div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, paddingTop: 14, borderTop: `1px solid ${theme.borderTable}` }}>
                <span style={{ fontSize: 12, color: theme.textFaint }}>{t("players.067")}</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="cs-btn-ghost" onClick={resetNewPlayerForm}>{t("players.044")}</button>
                  <button className="cs-btn" onClick={addPlayer}><UserPlus size={14} style={{ marginRight: 4, verticalAlign: -2 }} />{t("players.068")}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "playerData" && (
        <div>
          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <label style={labelStyle}>{t("players.008")}</label>
            <div style={{ fontSize: 13, color: theme.textFaint, marginBottom: 8 }}>
              {t("players.009")}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button className="cs-btn-ghost" onClick={exportData}>{t("players.010")}</button>
              <button className="cs-btn" onClick={importData}>{t("players.011")}</button>
              <button className="cs-btn-ghost" onClick={restoreLocalBackup}>{t("players.012")}</button>
              <button className="cs-btn-ghost" onClick={exportCsv}>{t("players.013")}</button>
              <button className="cs-btn-ghost" onClick={recomputeStreaks}>{t("players.014")}</button>
              <button className="cs-btn-ghost" style={{ borderColor: theme.teamB, color: theme.teamB }} onClick={resetSeason}>{t("players.015")}</button>
            </div>
            {ioMsg && <div style={{ fontSize: 14, color: theme.textSub, marginBottom: 6 }}>{ioMsg}</div>}
            <textarea className="cs-input" style={{ width: "100%", height: 80, boxSizing: "border-box", fontSize: 12 }}
              placeholder={t("players.016")}
              value={ioText} onChange={(e) => setIoText(e.target.value)} />
          </div>

          {customChamps.length > 0 && (
            <div style={{ ...cardStyle, marginBottom: 16 }}>
              <label style={labelStyle}>{t("players.046", { n: customChamps.length })}</label>
              <div style={{ fontSize: 13, color: theme.textFaint, marginBottom: 8 }}>
                {t("players.018")}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {customChamps.map((name) => (
                  <span key={name} style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    background: theme.surfaceWhite, border: `1px solid ${theme.borderInput}`, borderRadius: 5,
                    padding: "4px 8px 4px 10px", fontSize: 14,
                  }}>
                    {name}
                    <X size={13} style={{ cursor: "pointer", color: theme.textFaint }} onClick={() => removeCustomChamp(name)} />
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "playerList" && (() => {
        const searchLower = playerSearch.trim().toLowerCase();
        const searched = !searchLower ? sortedPlayersForList : sortedPlayersForList.filter((p) =>
          p.name.toLowerCase().includes(searchLower) || (p.summonerName || "").toLowerCase().includes(searchLower));
        const shown = searched.slice(0, listLimit);
        const jumpToMe = () => {
          if (!myPlayerId) return;
          const idx = searched.findIndex((p) => p.id === myPlayerId);
          if (idx === -1) return;
          if (idx >= listLimit) setListLimit(idx + 1);
          requestAnimationFrame(() => {
            document.getElementById(`player-row-${myPlayerId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          });
        };
        const statusModes = [["active", t("shell.047")], ["adjust", t("queue.003")], ["rest", t("players.028")]];
        return (
          <div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
              <input className="cs-input" style={{ flex: "1 1 220px" }} placeholder={t("players.051")}
                value={playerSearch} onChange={(e) => { setPlayerSearch(e.target.value); setListLimit(20); }} />
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, color: theme.textSub }}>{t("players.022")}</span>
                <select className="cs-input" style={{ padding: "4px 8px", fontSize: 13 }} value={playerSort} onChange={(e) => setPlayerSort(e.target.value)}>
                  <option value="name">{t("players.023")}</option>
                  <option value="rate_desc">{t("players.024")}</option>
                  <option value="rate_asc">{t("players.025")}</option>
                  {ROLES.map((r) => <option key={r} value={`role_${r}`}>{r}{t("players.026")}</option>)}
                </select>
              </span>
              <button className="cs-btn" style={{ padding: "8px 16px" }} onClick={() => setTab("playerRegister")}>
                <UserPlus size={14} style={{ marginRight: 4, verticalAlign: -2 }} />{t("header.029")}
              </button>
            </div>

            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              {[
                ["all", t("players.027"), players.length],
                ["active", t("shell.047"), players.filter((p) => p.status !== "rest" && !p.adjust).length],
                ["adjust", t("queue.003"), players.filter((p) => p.adjust).length],
                ["rest", t("players.028"), players.filter((p) => p.status === "rest").length],
                ["noResponse", t("attend.037"), players.filter(isStaleResponse).length],
              ].map(([key, label, count]) => (
                <button key={key} className="cs-btn-ghost" style={{
                  padding: "3px 12px", fontSize: 13,
                  borderColor: playerFilter === key ? theme.accent : theme.borderInput,
                  color: playerFilter === key ? theme.accent : theme.textSub,
                  fontWeight: playerFilter === key ? 700 : 500,
                }} onClick={() => { setPlayerFilter(key); setListLimit(20); }}>
                  {label}（{count}）
                </button>
              ))}
              {myPlayerId && (
                <button className="cs-btn-ghost" style={{ padding: "3px 12px", fontSize: 13, marginLeft: "auto" }} onClick={jumpToMe}>
                  {t("players.062")}
                </button>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: theme.textSub }}>{t("players.059")}</span>
              <button className="cs-btn-ghost" style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => setAllInactive(true)}>{t("players.020")}</button>
              <button className="cs-btn-ghost" style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => setAllInactive(false)}>{t("players.021")}</button>
              <span style={{ fontSize: 12, color: theme.textFaint, marginLeft: "auto" }}>
                {t("players.045", { a: searched.length, b: players.length })} ・ {t("players.032")}（◎1.00 〇0.92 △0.85 ×0.75）
                {players.some((p) => p.honorRank) && <> ・ {t("players.071")}</>}
              </span>
            </div>

            <div className="cs-scroll" style={{ overflowX: "auto" }}>
              <table className="cs-table">
                <thead>
                  <tr>
                    <th style={{ width: "100%", textAlign: "left" }}>{t("shell.028")}</th>
                    <th style={{ width: 1 }}>{t("board.016")}</th>
                    <th style={{ width: 1 }}>{t("players.063")}</th>
                    {ROLES.map((r) => <th key={r} style={{ width: 1 }}>{r}</th>)}
                    <th style={{ width: 1 }}>{t("players.064")}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const myReq = rankRequests.find((r) => r.playerId === p.id);
                    const expanded = editId === p.id || rankReqOpenFor === p.id || !!myReq;
                    return (
                      <React.Fragment key={p.id}>
                        <tr id={`player-row-${p.id}`} style={{ background: p.id === myPlayerId ? theme.surfaceAlt : "transparent" }}>
                          <td style={{ textAlign: "left" }}>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontWeight: 700 }}>{p.name}</span>
                              {p.id === myPlayerId && (
                                <span style={{ fontSize: 11, fontWeight: 700, color: theme.accent, border: `1px solid ${theme.accent}`, borderRadius: 10, padding: "0 6px" }}>
                                  {t("players.065")}
                                </span>
                              )}
                              {opggUrl(p.summonerName) && (
                                <a href={opggUrl(p.summonerName)} target="_blank" rel="noopener noreferrer" style={{ color: theme.accentBright, display: "inline-flex" }}>
                                  <ExternalLink size={13} />
                                </a>
                              )}
                            </div>
                          </td>
                          <td title={p.honorRank ? t("players.072", { honor: rankLabel(p.honorRank), rank: rankLabel(p.rank || "アンランク") }) : undefined}>
                            {p.honorRank ? (
                              <>
                                <span style={{ color: theme.accent, fontWeight: 700 }}>↑{rankShortLang(p.honorRank)}</span>
                                <span style={{ color: theme.textFaint, fontSize: 12.5, marginLeft: 4 }}>({p.rank ? rankShortLang(p.rank) : "-"})</span>
                              </>
                            ) : (p.rank ? rankShortLang(p.rank) : "-")}
                          </td>
                          <td>
                            <div style={{ display: "inline-flex", borderRadius: 6, overflow: "hidden", border: `1px solid ${theme.borderInput}` }}>
                              {statusModes.map(([mode, label]) => {
                                const on = mode === "rest" ? p.status === "rest" : mode === "adjust" ? p.adjust : (p.status !== "rest" && !p.adjust);
                                return (
                                  <button key={mode} onClick={() => setParticipation(p.id, mode)}
                                    style={{
                                      padding: "5px 9px", fontSize: 12, border: "none", cursor: "pointer", whiteSpace: "nowrap",
                                      background: on ? theme.accent : theme.surfaceWhite,
                                      color: on ? "#FFF8EC" : theme.textSub, fontWeight: on ? 700 : 400,
                                    }}>
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                          {ROLES.map((r) => {
                            const wanted = (p.prefRoles || []).includes(r);
                            const isNg = (p.ngRoles || []).includes(r);
                            return (
                              <td key={r} onClick={() => cyclePrefRole(p.id, r)}
                                title={isNg ? `${t("players.034")} ${r}` : t("players.031")}
                                style={{ padding: 4, cursor: "pointer" }}>
                                <div style={{
                                  borderRadius: 6, padding: "4px 2px", textAlign: "center", minWidth: 46,
                                  background: isNg ? theme.teamB : wanted ? theme.accent : theme.surfaceAlt,
                                  border: isNg || wanted ? "none" : `1px solid ${theme.borderInput}`,
                                  color: isNg || wanted ? "#FFF8EC" : theme.text,
                                }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.02em" }}>
                                    {wanted && "★"}{isNg && "✕"}<ProfBadge prof={p.roles[r].prof} />
                                  </div>
                                  <div style={{ fontSize: 15, fontWeight: 700 }}>{p.roles[r].mu.toFixed(1)}</div>
                                </div>
                              </td>
                            );
                          })}
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <button className="cs-btn-ghost" style={{ padding: "2px 8px", fontSize: 11.5 }}
                                title={t("players.041")}
                                onClick={() => {
                                  if (editId === p.id) { setEditId(null); setEditForm(null); return; }
                                  if (rankReqOpenFor === p.id) { setRankReqOpenFor(null); setRankReqProfs({}); return; }
                                  if (myReq) return;
                                  setRankReqValue(p.rank || "アンランク");
                                  const initProfs = {};
                                  ROLES.forEach((r) => { initProfs[r] = p.roles[r].prof; });
                                  setRankReqProfs(initProfs);
                                  setRankReqOpenFor(p.id);
                                }}>
                                {t("players.069")}
                              </button>
                              <Pencil size={15} style={{ cursor: "pointer", color: theme.accent, flexShrink: 0 }} onClick={() => startEdit(p)} />
                              <Trash2 size={15} style={{ cursor: "pointer", color: theme.textFaint, flexShrink: 0 }} onClick={() => removePlayer(p.id)} />
                            </div>
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={9} style={{ background: theme.surfaceAlt }}>
                              {myReq && (() => {
                                const profDiffs = ROLES.filter((r) => myReq.toProfs[r] !== myReq.fromProfs[r]);
                                return (
                                  <div style={{ fontSize: 13, color: theme.accent, padding: "6px 4px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                      <span>{t("players.035")}</span>
                                      <button className="cs-btn-ghost" style={{ padding: "1px 8px", fontSize: 11.5 }} onClick={() => cancelRankRequest(myReq.id)}>{t("players.036")}</button>
                                    </div>
                                    {myReq.toRank !== myReq.fromRank && <div>{t("shell.021")} {rankShortLang(myReq.fromRank)} → {rankShortLang(myReq.toRank)}</div>}
                                    {profDiffs.length > 0 && <div>{t("playerReq.004")} {profDiffs.map((r) => `${r} ${myReq.fromProfs[r]}→${myReq.toProfs[r]}`).join("、")}</div>}
                                  </div>
                                );
                              })()}
                              {!myReq && rankReqOpenFor === p.id && (
                                <div style={{ padding: 8 }}>
                                  <div style={{ fontSize: 12, color: theme.textSub, marginBottom: 4 }}>{t("players.037")}</div>
                                  <select className="cs-input" style={{ padding: "3px 6px", fontSize: 13, marginBottom: 8 }} value={rankReqValue} onChange={(e) => setRankReqValue(e.target.value)}>
                                    {RANKS.map(([label]) => <option key={label} value={label}>{rankLabel(label)}</option>)}
                                  </select>
                                  <div style={{ fontSize: 12, color: theme.textSub, marginBottom: 4 }}>{t("players.038")}</div>
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                                    {ROLES.map((r) => (
                                      <label key={r} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 13 }}>
                                        {r}
                                        <select className="cs-input" style={{ padding: "2px 4px", fontSize: 13 }}
                                          value={rankReqProfs[r] ?? p.roles[r].prof}
                                          onChange={(e) => setRankReqProfs({ ...rankReqProfs, [r]: e.target.value })}>
                                          {PROFS.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
                                        </select>
                                      </label>
                                    ))}
                                  </div>
                                  <button className="cs-btn" style={{ padding: "3px 10px", fontSize: 13, marginRight: 6 }}
                                    onClick={async () => {
                                      const toProfs = {};
                                      ROLES.forEach((r) => { toProfs[r] = rankReqProfs[r] ?? p.roles[r].prof; });
                                      await submitRankRequest(p.id, rankReqValue, toProfs);
                                      setRankReqOpenFor(null); setRankReqProfs({});
                                    }}>{t("players.039")}</button>
                                  <button className="cs-btn-ghost" style={{ padding: "3px 10px", fontSize: 13 }} onClick={() => { setRankReqOpenFor(null); setRankReqProfs({}); }}>{t("players.040")}</button>
                                </div>
                              )}
                              {editId === p.id && editForm && (
                                <div style={{ padding: 8 }}>
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                                    <input className="cs-input" style={{ width: 140 }} value={editForm.name}
                                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder={t("players.042")} />
                                    <input className="cs-input" style={{ width: 180 }} value={editForm.summonerName}
                                      onChange={(e) => setEditForm({ ...editForm, summonerName: e.target.value })} placeholder={t("players.003")} />
                                    <select className="cs-input" value={editForm.rank}
                                      onChange={(e) => setEditForm({ ...editForm, rank: e.target.value })}>
                                      {RANKS.map(([label, mu]) => <option key={label} value={label}>{rankLabel(label)} ({mu}pt)</option>)}
                                    </select>
                                    <select className="cs-input" title={t("players.047")} value={editForm.honorRank}
                                      onChange={(e) => setEditForm({ ...editForm, honorRank: e.target.value })}>
                                      <option value="">{t("players.047")}: {t("players.048")}</option>
                                      {RANKS.filter(([, mu]) => mu > (rankMu(editForm.rank) ?? MU0)).map(([label, mu]) => (
                                        <option key={label} value={label}>{t("players.047")}: {rankLabel(label)} ({mu}pt)</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 8, maxWidth: 480 }}>
                                    {ROLES.map((r) => (
                                      <div key={r}>
                                        <div style={{ fontSize: 13, color: theme.textSub, textAlign: "center" }}>{r}</div>
                                        <select className="cs-input" style={{ width: "100%", padding: "4px", textAlign: "center" }}
                                          value={editForm.profs[r]}
                                          onChange={(e) => setEditForm({ ...editForm, profs: { ...editForm.profs, [r]: e.target.value } })}>
                                          {PROFS.map((pf) => <option key={pf} value={pf}>{pf}</option>)}
                                        </select>
                                      </div>
                                    ))}
                                  </div>
                                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                    <label style={{ fontSize: 14, color: theme.textSub, display: "flex", alignItems: "center", gap: 4 }}>
                                      <select className="cs-input" style={{ padding: "4px 8px", fontSize: 14 }} value={editForm.status === "rest" ? "rest" : editForm.adjust ? "adjust" : "active"}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          setEditForm({ ...editForm, status: v === "rest" ? "rest" : "active", adjust: v === "adjust" });
                                        }}>
                                        <option value="active">{t("shell.047")}</option>
                                        <option value="adjust">{t("queue.003")}</option>
                                        <option value="rest">{t("players.028")}</option>
                                      </select>
                                    </label>
                                    <button className="cs-btn" onClick={saveEdit}>{t("players.043")}</button>
                                    <button className="cs-btn-ghost" onClick={() => { setEditId(null); setEditForm(null); }}>{t("players.044")}</button>
                                    {editError && <span style={{ fontSize: 14, color: theme.teamB }}>{editError}</span>}
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {searched.length > listLimit && (
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <button className="cs-btn-ghost" style={{ padding: "6px 20px" }} onClick={() => setListLimit((v) => v + 20)}>
                  {t("players.061", { n: searched.length - listLimit })}
                </button>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

/* --------------------------- helpers --------------------------- */
const labelStyle = { display: "block", fontSize: 15.5, color: theme.textSub, marginBottom: 6 };
const cardStyle = { background: theme.surface, border: `1px solid ${theme.borderTable}`, borderRadius: 12, padding: 14, boxShadow: "0 1px 4px rgba(27,58,86,0.07)" };

function EmptyState({ text }) {
  return (
    <div style={{ ...cardStyle, textAlign: "center", color: theme.textFaint, padding: 32, fontSize: 15 }}>
      {text}
    </div>
  );
}

function MatchEditForm({ form, players, setEntryField, setKda, setEntryPlayer, setWinner, error, onSave, onCancel, champList, customChamps }) {
  const usedIds = new Set(form.entries.map((e) => e.playerId));
  return (
    <div style={{ ...cardStyle, marginTop: 10, background: theme.surfaceAlt }}>
      <datalist id="champListEdit">
        {[...champList, ...customChamps].map((ch) => <option key={ch} value={champLabel(ch)} />)}
      </datalist>
      <div className="cs-cols2" style={{ marginBottom: 10 }}>
        {["A", "B"].map((side) => (
          <div key={side}>
            <div style={{ fontSize: 16, fontWeight: 700, color: side === "A" ? theme.accentBright : theme.teamB, marginBottom: 6 }}>{sideLabel(side)}</div>
            {form.entries.map((e, idx) => ({ e, idx })).filter(({ e }) => e.team === side).map(({ e, idx }) => (
              <div key={idx} className="cs-reprow6" style={{ marginBottom: 6 }}>
                <select className="cs-input" style={{ padding: "5px 4px", fontSize: 15 }} value={e.role} onChange={(ev) => setEntryField(idx, "role", ev.target.value)}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <select className="cs-input" style={{ padding: "5px 4px", fontSize: 15, minWidth: 0 }} value={e.playerId}
                  onChange={(ev) => setEntryPlayer(idx, ev.target.value)}>
                  {players.filter((p) => p.id === e.playerId || !usedIds.has(p.id)).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <input className="cs-input" list="champListEdit" style={{ padding: "5px 6px", fontSize: 15, minWidth: 0 }} placeholder={t("shell.031")}
                  value={champLabel(e.champion) || ""} onChange={(ev) => setEntryField(idx, "champion", ev.target.value)} />
                {["k", "d", "a"].map((f) => (
                  <input key={f} className="cs-input" style={{ padding: "5px 3px", fontSize: 15, textAlign: "center", minWidth: 0 }}
                    placeholder={f.toUpperCase()} type="number" min="0"
                    value={form.kda[e.playerId]?.[f] ?? ""} onChange={(ev) => setKda(e.playerId, f, ev.target.value)} />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 13, color: theme.textFaint, marginBottom: 6 }}>{t("misc.001")}</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
        <span style={{ fontSize: 16, color: theme.textSub }}>{t("misc.002")}</span>
        <button className="cs-btn-ghost" style={{ borderColor: form.winner === "A" ? theme.accentBright : theme.borderInput, color: form.winner === "A" ? theme.accentBright : theme.text, padding: "6px 14px", fontSize: 15 }} onClick={() => setWinner("A")}>A</button>
        <button className="cs-btn-ghost" style={{ borderColor: form.winner === "B" ? theme.teamB : theme.borderInput, color: form.winner === "B" ? theme.teamB : theme.text, padding: "6px 14px", fontSize: 15 }} onClick={() => setWinner("B")}>B</button>
        <button className="cs-btn" style={{ fontSize: 15 }} onClick={onSave}>{t("misc.003")}</button>
        <button className="cs-btn-ghost" style={{ fontSize: 15 }} onClick={onCancel}>{t("players.044")}</button>
        {error && <span style={{ fontSize: 15, color: theme.teamB }}>{error}</span>}
      </div>
    </div>
  );
}

function MatchTeams({ m, nameOf }) {
  const side = (t, color) => (
    <div style={{ flex: 1 }}>
      <span style={{ color: m.winner === t ? color : theme.textSub, fontWeight: 700 }}>
        {sideLabel(t)} {m.winner === t && "🏆"}
      </span>
      <div style={{ color: theme.textSub }}>
        {m.entries.filter((e) => e.team === t).map((e) => `${nameOf(e.playerId)}(${e.role})`).join(", ")}
      </div>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 16, fontSize: 15 }}>
      {side("A", theme.accentBright)}
      {side("B", theme.teamB)}
    </div>
  );
}
