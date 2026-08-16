// アイテム金銭効率: DDragon item.json から統合stats算出→換算レート自動導出→効率計算。
// 全て純粋関数(DOM/fetch非依存)。ユニットテストは itemEfficiency.test.mjs 参照。

// キルスタック等で最大値まで積み上がる系のステータス(例: グラトナスブーツのSlay=オムニヴァンプ)を算出する。
// 数値は都度description本文から読み取り、ハードコードしない(パッチで変動しても追従する)。
// 記法揺れに対応するため複数パターンを順に試す:
//   1. 「for a total of 6%」形式 → 合計値を直接採用(最も頑健)
//   2. 「0.6% ... stacking up to 10 (times)」形式 → 増分×最大回数(attentionタグの有無は不問)
// いずれもマッチしなければ0(=補正なし)。
export function parseStackingBonus(description, statLabel) {
  if (!description || typeof description !== "string") return 0;
  const labelRe = statLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // パターン1: 合計値の明記(「stacking up to N times for a total of X%」)
  const reTotal = new RegExp(
    `${labelRe}[\\s\\S]{0,120}?total of\\s*(?:<[^>]+>\\s*)?([\\d.]+)\\s*%`,
    "i"
  );
  const mt = description.match(reTotal);
  if (mt) return parseFloat(mt[1]);
  // パターン2: 「stacking up to N」を起点に、直前ウィンドウ内で最も近い「X% ラベル」を増分として採用
  // (先頭一致だと<stats>ブロックの基礎値を誤って増分と解釈する恐れがあるため、後方最近傍を取る)
  const stackRe = /stacking up to\s*(?:<[^>]+>\s*)?(\d+)/i;
  const sm = description.match(stackRe);
  if (!sm) return 0;
  const windowText = description.slice(Math.max(0, sm.index - 150), sm.index);
  const valRe = new RegExp(
    `(?:<[^>]+>\\s*)?([\\d.]+)\\s*%?\\s*(?:<\\/[^>]+>\\s*)?%?\\s*${labelRe}`,
    "gi"
  );
  let last = null, mv;
  while ((mv = valRe.exec(windowText))) last = mv;
  if (!last) return 0;
  return parseFloat(last[1]) * parseFloat(sm[1]);
}

// ---- ソースB: description内<stats>ブロックのラベル→内部キー ----
// 注意: flatキーと同一概念のものは必ず同じキー名にすること(重複計上防止のdedupがキー名一致に依存するため)
// 値が { flat, percent } 形式のラベルは%記号の有無でキーが分岐する(魔法貫通の実数/%等)
export const DESC_STAT_LABELS = {
  "Ability Haste": "abilityHaste",
  "Lethality": "lethality",
  "Magic Penetration": { flat: "magicPen", percent: "percentMagicPen" },
  "Armor Penetration": "percentArmorPen", // 実数物理貫通はLethality表記のため常に%
  "Omnivamp": "omnivamp",
  "Life Steal": "PercentLifeStealMod",   // ソースAのFlatキーと同名にして重複計上を防ぐ
  "Heal and Shield Power": "healShieldPower",
  "Base Health Regen": "FlatHPRegenMod", // 同上
  "Base Mana Regen": "FlatMPRegenMod",   // 同上
  "Tenacity": "tenacity",
};

// ---- ソースA: item.stats の構造化キー一覧(統合stats生成時にそのままコピー) ----
export const FLAT_STAT_KEYS = [
  "FlatPhysicalDamageMod", "FlatMagicDamageMod", "FlatArmorMod", "FlatSpellBlockMod",
  "FlatHPPoolMod", "FlatMPPoolMod", "PercentAttackSpeedMod", "FlatCritChanceMod",
  "FlatMovementSpeedMod", "PercentMovementSpeedMod", "PercentLifeStealMod", "FlatHPRegenMod",
  "FlatMPRegenMod",
];

// ---- パス1: 単一ステータス基礎アイテムからのレート導出元 ----
export const RATE_SOURCES_PURE = {
  FlatPhysicalDamageMod: "1036", // ロングソード
  FlatMagicDamageMod: "1052",    // 増魔の書
  FlatArmorMod: "1029",          // クロースアーマー
  FlatSpellBlockMod: "1033",     // ヌルマジックマント
  FlatHPPoolMod: "1028",         // ルビークリスタル
  FlatMPPoolMod: "1027",         // サファイアクリスタル
  PercentAttackSpeedMod: "1042", // ダガー
  FlatCritChanceMod: "1018",     // アジリティクローク
  FlatMovementSpeedMod: "1001",  // ブーツ
  abilityHaste: "2022",          // グロウイングモート
};

// ---- パス2: 残差方式(複合アイテム・貫通系含む) ----
export const RATE_SOURCES_RESIDUAL = {
  PercentLifeStealMod: { itemId: "1053", knownKeys: ["FlatPhysicalDamageMod"] },
  FlatHPRegenMod: { itemId: "1006", knownKeys: [] },
  FlatMPRegenMod: { itemId: "1004", knownKeys: [] },
  lethality: { itemId: "3134", knownKeys: ["FlatPhysicalDamageMod"] },
  magicPen: { itemId: "3020", knownKeys: ["FlatMovementSpeedMod"] },
  percentMagicPen: { itemId: "4630", knownKeys: ["FlatMagicDamageMod"] },
  percentArmorPen: { itemId: "3035", knownKeys: ["FlatPhysicalDamageMod"] },
  tenacity: { itemId: "3111", knownKeys: ["FlatMovementSpeedMod", "FlatSpellBlockMod"] },
  healShieldPower: { itemId: "3114", knownKeys: ["FlatMPRegenMod"] },
  PercentMovementSpeedMod: { itemId: "3113", knownKeys: ["FlatMagicDamageMod"] }, // エーテルウィスプ(AP分を差引)
  omnivamp: { itemId: "3008", knownKeys: ["FlatMovementSpeedMod"] }, // グラトナスブーツ(MS45分を差引、公式慣例に合わせ基礎+Slay最大スタックを分母に使用)
};

// description(HTML文字列)の<stats>ブロックから、ソースAに無いステータスを抽出する。
// フォーマット崩れ・未知ラベルは黙ってスキップ(クラッシュしない)。
export function parseDescStats(description) {
  const out = {};
  if (!description || typeof description !== "string") return out;
  const statsMatch = description.match(/<stats>([\s\S]*?)<\/stats>/);
  const block = statsMatch ? statsMatch[1] : description; // <stats>が無い版でも本文全体から拾う保険
  // %は内側(<attention>40%</attention>)と外側の両パターンに対応。
  // %の有無をキャプチャしてflat/percentのキー分岐に使う(魔法貫通の実数/%区別)
  const re = /<attention>\s*([\d.]+)\s*(%?)\s*<\/attention>\s*(%?)\s*([^<{]+)/g;
  let m;
  while ((m = re.exec(block))) {
    const val = parseFloat(m[1]);
    const isPercent = m[2] === "%" || m[3] === "%";
    const rawLabel = m[4].trim();
    if (Number.isNaN(val)) continue;
    const label = Object.keys(DESC_STAT_LABELS).find((l) => rawLabel.startsWith(l));
    if (!label) continue;
    const mapping = DESC_STAT_LABELS[label];
    const key = typeof mapping === "string" ? mapping : (isPercent ? mapping.percent : mapping.flat);
    out[key] = (out[key] || 0) + val;
  }
  return out;
}

// item(DD1件分) + statsフィールド + description から統合statsを作る。
// ソースA(item.stats)を正とし、ソースB(description)はソースAに無いキーのみ補完。
// ソースAで割合(0.25=25%)として格納されるキー。統合時に×100して表示単位(25)へ正規化する
export const FRACTION_KEYS = new Set([
  "PercentAttackSpeedMod", "FlatCritChanceMod", "PercentLifeStealMod", "PercentMovementSpeedMod",
]);
// UI表示時に%を付けるキー
export const PERCENT_DISPLAY_KEYS = new Set([
  "PercentAttackSpeedMod", "FlatCritChanceMod", "PercentLifeStealMod", "PercentMovementSpeedMod",
  "percentArmorPen", "percentMagicPen", "omnivamp", "healShieldPower", "tenacity",
  "FlatHPRegenMod", "FlatMPRegenMod",
]);

export function mergeStats(item) {
  const merged = {};
  const raw = item.stats || {};
  FLAT_STAT_KEYS.forEach((k) => {
    if (!raw[k]) return;
    merged[k] = FRACTION_KEYS.has(k) ? raw[k] * 100 : raw[k];
  });
  const descStats = parseDescStats(item.description);
  Object.entries(descStats).forEach(([k, v]) => {
    if (merged[k] == null) merged[k] = v; // ソースA優先、無い場合のみ採用
  });
  return merged;
}

// パス1: 単一ステータス基礎アイテムからレートを導出。
// itemsById: { [id]: {gold:{total}, stats, description} } のようなDD生データ(statsは統合済みでなくてもよい)
export function deriveRatesPure(itemsById) {
  const rates = {};
  const sources = {}; // statKey -> 基準アイテムID(UIの「基準アイテム」表示用)
  Object.entries(RATE_SOURCES_PURE).forEach(([statKey, itemId]) => {
    const src = itemsById[itemId];
    if (!src || !src.gold || !src.gold.total) return;
    const merged = mergeStats(src);
    const val = merged[statKey];
    if (!val || val <= 0) return;
    rates[statKey] = src.gold.total / val;
    sources[statKey] = itemId;
  });
  return { rates, sources };
}

// パス2: 残差方式(多段依存を収束するまで反復)。
// pureRatesを初期値として、導出できるものから順にratesへ追加していく。
export function deriveRatesResidual(itemsById, pureResult) {
  const rates = { ...pureResult.rates };
  const sources = { ...pureResult.sources };
  const pending = { ...RATE_SOURCES_RESIDUAL };
  let progressed = true;
  const skipped = [];
  while (progressed) {
    progressed = false;
    for (const statKey of Object.keys(pending)) {
      const { itemId, knownKeys } = pending[statKey];
      const src = itemsById[itemId];
      if (!src || !src.gold || !src.gold.total) { delete pending[statKey]; skipped.push(statKey); continue; }
      const merged = mergeStats(src);
      let targetVal = merged[statKey];
      if (statKey === "omnivamp") {
        // 公式慣例(グラトナスブーツの基礎値+Slay最大スタック値を分母に使用)に合わせる。
        // 数値はdescription本文から都度算出するためハードコードなし
        targetVal = (targetVal || 0) + parseStackingBonus(src.description, "Omnivamp");
      }
      if (!targetVal || targetVal <= 0) { delete pending[statKey]; skipped.push(statKey); continue; }

      // 依存キーが全て導出済みか確認(未導出が1つでもあれば次周回に持ち越し)
      const allKnown = knownKeys.every((k) => rates[k] != null);
      if (!allKnown) continue;

      const knownValue = knownKeys.reduce((sum, k) => sum + (merged[k] || 0) * rates[k], 0);
      const residualGold = src.gold.total - knownValue;
      if (residualGold <= 0) { delete pending[statKey]; skipped.push(statKey); continue; } // 負残差ガード

      rates[statKey] = residualGold / targetVal;
      sources[statKey] = itemId;
      delete pending[statKey];
      progressed = true;
    }
  }
  // 収束後も残った(依存不足で解決不能な)キーはスキップ扱い
  Object.keys(pending).forEach((k) => skipped.push(k));
  return { rates, sources, skipped };
}

// 全アイテムの効率%を計算。
// statsData: en_US版item.json(統計抽出用・レート導出用)。namesData: 表示言語版(省略時はstatsDataの名前を使用)
// 別ゲームモード専用なのにDDデータ上maps["11"]がtrueになっているアイテムの除外パターン(en_US名で判定)。
// DD側のデータ不備へのワークアラウンド。パターン追加はここに集約する
export const EXCLUDED_MODE_ITEM_PATTERNS = [
  /^Guardian's /i, // ARAMスターター(ガーディアン系)
];

// 戻り値: { results: [{id, name, gold, stats, efficiency, breakdown}], skippedStats: string[] }
export function computeEfficiency(statsData, namesData) {
  const itemsById = statsData.data || {};
  const namesById = (namesData && namesData.data) || itemsById;
  const pureResult = deriveRatesPure(itemsById);
  const { rates, sources, skipped } = deriveRatesResidual(itemsById, pureResult);

  const results = [];
  const seenNames = new Set(); // 同名重複(ドーンコア・冬の訪れ等)の排除用。en名とローカライズ名の両方で判定
  const entries = Object.entries(itemsById).sort((a, b) => parseInt(a[0]) - parseInt(b[0])); // ID昇順=本来のSRアイテムを優先
  entries.forEach(([id, item]) => {
    if (!item.gold || !item.gold.total || !item.gold.purchasable) return;
    if (!item.maps || item.maps["11"] !== true) return;
    if (item.inStore === false) return; // ストア非表示アイテム除外
    if (item.requiredChampion || item.requiredAlly) return; // チャンピオン専用(オーン強化等)除外
    if (parseInt(id) >= 100000) return; // アリーナ等のミラーID(22xxxx帯)除外
    const tags = item.tags || [];
    if (tags.includes("Consumable") || tags.includes("Trinket")) return;
    if (EXCLUDED_MODE_ITEM_PATTERNS.some((re) => re.test(item.name || ""))) return; // モード専用アイテム除外(DDデータ不備対応)

    const localized = namesById[id];
    const displayName = (localized && localized.name) || item.name;
    // 同名重複: en名・表示名のどちらかが既出なら除外(表示上の重複を確実に防ぐ)
    if (seenNames.has(item.name) || seenNames.has(displayName)) return;
    seenNames.add(item.name);
    seenNames.add(displayName);

    const merged = mergeStats(item);
    let value = 0;
    const breakdown = [];
    Object.entries(merged).forEach(([k, v]) => {
      if (rates[k] == null) return;
      const gv = v * rates[k];
      value += gv;
      breakdown.push({ key: k, amount: v, goldValue: gv });
    });
    const efficiency = item.gold.total > 0 ? (value / item.gold.total) * 100 : 0;

    const tier = !item.from || item.from.length === 0 ? "base"
      : (item.into && item.into.length > 0 ? "epic" : "legendary");

    results.push({
      id, name: displayName, gold: item.gold.total,
      stats: merged, breakdown, efficiency, tier,
      image: item.image && item.image.full,
    });
  });

  // レートが導出できていないのに実アイテムに登場したキーも除外一覧へ(設計漏れ対策:
  // RATE_SOURCESに未定義のキーは従来skippedに載らず「静かに無視」されていた)
  const seenStatKeys = new Set();
  results.forEach((r) => Object.keys(r.stats).forEach((k) => seenStatKeys.add(k)));
  seenStatKeys.forEach((k) => { if (rates[k] == null && !skipped.includes(k)) skipped.push(k); });

  // 換算レート一覧(UIの「基準アイテム」パネル用): statキー・レート・基準アイテムID/表示名
  const rateInfo = Object.entries(rates).map(([key, rate]) => {
    const srcId = sources[key];
    const localizedSrc = srcId != null ? namesById[srcId] : null;
    const enSrc = srcId != null ? itemsById[srcId] : null;
    return {
      key, rate, sourceItemId: srcId || null,
      sourceName: (localizedSrc && localizedSrc.name) || (enSrc && enSrc.name) || null,
      sourceImage: enSrc && enSrc.image && enSrc.image.full,
    };
  });

  return { results, skippedStats: [...new Set(skipped)], rateInfo };
}
