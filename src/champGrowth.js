// チャンピオン基礎ステータスのレベル成長計算（純粋関数）
//   データは champStats.js（CommunityDragon 由来）。
//   アイテム・ルーン・パッシブは非適用。基礎値のみ。

export const MAX_LEVEL = 18;

// Riot の非線形レベル係数。Lv1 → 0 / Lv18 → 17。
// stat(N) = base + growth × coef(N)
export function growthCoef(level) {
  const n = Math.max(0, level - 1);
  return n * (0.7025 + 0.0175 * n);
}

// 通常ステータス（HP / AD / 防御 / regen など）
export function statAt(base, perLevel, level) {
  return base + (perLevel || 0) * growthCoef(level);
}

// 攻撃速度: 成長分はボーナスAS%として asRatio を介して加算される。
//   totalAS = baseAS + asRatio × (asPerLv/100) × coef(N)
// asPerLv は「%」表記（例 3 = 3%）。上限 2.5。
export function attackSpeedAt(baseAS, asRatio, asPerLevel, level) {
  const bonus = (asRatio || baseAS) * ((asPerLevel || 0) / 100) * growthCoef(level);
  return Math.min(baseAS + bonus, 2.5);
}

// 移動速度・射程はレベル成長なし。
export function moveSpeedAt(base) { return base; }
export function attackRangeAt(base) { return base; }

// 1体の全ステータスを指定レベルで算出。
export function computeAt(s, level) {
  return {
    hp: statAt(s.hp, s.hpPerLv, level),
    mp: statAt(s.mp, s.mpPerLv, level),
    ad: statAt(s.ad, s.adPerLv, level),
    armor: statAt(s.armor, s.armorPerLv, level),
    mr: statAt(s.mr, s.mrPerLv, level),
    hp5: statAt(s.hp5, s.hp5PerLv, level),
    mp5: statAt(s.mp5, s.mp5PerLv, level),
    as: attackSpeedAt(s.as, s.asRatio, s.asPerLv, level),
    ms: s.ms,
    range: s.range,
  };
}

// 表示行の定義。key = computeAt の返却キー / raw = champStats の成長フィールド。
// manaOnly: マナ使用チャンピオンのみ表示。
export const STAT_ROWS = [
  { key: "hp", raw: "hpPerLv", labelKey: "growth.020", dec: 0 },
  { key: "hp5", raw: "hp5PerLv", labelKey: "growth.021", dec: 1 },
  { key: "mp", raw: "mpPerLv", labelKey: "growth.022", dec: 0, manaOnly: true },
  { key: "mp5", raw: "mp5PerLv", labelKey: "growth.023", dec: 1, manaOnly: true },
  { key: "ad", raw: "adPerLv", labelKey: "growth.024", dec: 0 },
  { key: "as", raw: "asPerLv", labelKey: "growth.025", dec: 3, isAS: true },
  { key: "armor", raw: "armorPerLv", labelKey: "growth.026", dec: 1 },
  { key: "mr", raw: "mrPerLv", labelKey: "growth.027", dec: 1 },
  { key: "ms", raw: null, labelKey: "growth.028", dec: 0, flat: true },
  { key: "range", raw: null, labelKey: "growth.029", dec: 0, flat: true },
];

export const COMPARE_LEVELS = [1, 6, 11, 16, 18];
