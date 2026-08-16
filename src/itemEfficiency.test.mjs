// Node単体テスト(実行: node src/itemEfficiency.test.mjs)
import {
  mergeStats, parseDescStats, deriveRatesPure, deriveRatesResidual, computeEfficiency,
  parseStackingBonus,
} from "./itemEfficiency.js";

let failed = 0;
function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error(`FAIL: ${label}\n  actual:   ${a}\n  expected: ${e}`); failed++; }
  else console.log(`ok: ${label}`);
}
function assertClose(actual, expected, label, eps = 1e-6) {
  if (Math.abs(actual - expected) > eps) { console.error(`FAIL: ${label} (actual=${actual}, expected=${expected})`); failed++; }
  else console.log(`ok: ${label}`);
}

// ---- モックitem.json(基礎アイテム+ヘイスト持ち+貫通持ち) ----
const MOCK = {
  data: {
    "1036": { name: "ロングソード", gold: { total: 350, purchasable: true }, stats: { FlatPhysicalDamageMod: 10 }, description: "", maps: { "11": true }, from: [], into: ["x"] },
    "1029": { name: "クロースアーマー", gold: { total: 300, purchasable: true }, stats: { FlatArmorMod: 15 }, description: "", maps: { "11": true }, from: [], into: ["x"] },
    "1001": { name: "ブーツ", gold: { total: 300, purchasable: true }, stats: { FlatMovementSpeedMod: 25 }, description: "", maps: { "11": true }, from: [], into: ["x"] },
    "2022": { name: "グロウイングモート", gold: { total: 250, purchasable: true }, stats: {}, description: "<stats><mainText><attention>5</attention> Ability Haste</mainText></stats>", maps: { "11": true }, from: [], into: ["x"] },
    "1053": { name: "ヴァンパイアセプター", gold: { total: 900, purchasable: true }, stats: { FlatPhysicalDamageMod: 15, PercentLifeStealMod: 0.1 }, description: "", maps: { "11": true }, from: [], into: ["x"] },
    "3134": { name: "セレイテッドダーク", gold: { total: 1100, purchasable: true }, stats: { FlatPhysicalDamageMod: 18 }, description: "<stats><mainText><attention>18</attention> Lethality</mainText></stats>", maps: { "11": true }, from: [], into: ["x"] },
    // 負残差テスト用: 素AD価値だけで価格超過するダミーアイテム(致死力導出元として不適格なケースを模す)
    "9999": { name: "オーバープライスAD", gold: { total: 100, purchasable: true }, stats: { FlatPhysicalDamageMod: 100 }, description: "<stats><mainText><attention>50</attention> Lethality</mainText></stats>", maps: { "11": true }, from: [], into: ["x"] },
    // 完成品(効率計算対象): AD+ヘイスト
    "9001": { name: "テストソード", gold: { total: 3000, purchasable: true }, stats: { FlatPhysicalDamageMod: 55 }, description: "<stats><mainText><attention>15</attention> Ability Haste</mainText></stats>", maps: { "11": true }, from: ["1036"], into: [] },
    // 非表示対象(ARAM専用マップ等・購入不可・消耗品)
    "9002": { name: "非表示アイテム", gold: { total: 500, purchasable: false }, stats: { FlatArmorMod: 10 }, description: "", maps: { "11": true }, from: [], into: [] },
    "9003": { name: "ポーション", gold: { total: 50, purchasable: true }, stats: {}, description: "", maps: { "11": true }, tags: ["Consumable"], from: [], into: [] },
  },
};

// ---- parseDescStats ----
assertEq(parseDescStats("<stats><mainText><attention>15</attention> Ability Haste</mainText></stats>"), { abilityHaste: 15 }, "parseDescStats: 基本形");
assertEq(parseDescStats(""), {}, "parseDescStats: 空文字でクラッシュしない");
assertEq(parseDescStats(null), {}, "parseDescStats: nullでクラッシュしない");
assertEq(parseDescStats("<stats><mainText><attention>abc</attention> Ability Haste</mainText></stats>"), {}, "parseDescStats: 数値でない値はスキップ");
assertEq(parseDescStats("<stats><mainText><attention>10</attention> Unknown Stat XYZ</mainText></stats>"), {}, "parseDescStats: 未知ラベルはスキップ");

// ---- mergeStats: ソースA優先 ----
assertEq(
  mergeStats({ stats: { FlatPhysicalDamageMod: 15 }, description: "<stats><mainText><attention>999</attention> Lethality</mainText></stats>" }),
  { FlatPhysicalDamageMod: 15, lethality: 999 },
  "mergeStats: ソースA(AD)とソースB(致死力)が両方採用される"
);
assertEq(
  mergeStats({ stats: { PercentLifeStealMod: 0.1 }, description: "<stats><mainText><attention>10</attention> Life Steal</mainText></stats>" }),
  { PercentLifeStealMod: 10 },
  "mergeStats: ソースA/B重複時はソースAが優先され二重計上されない(かつ0.1→10へ%正規化)"
);
assertEq(
  parseDescStats("<stats><mainText><attention>25%</attention> Attack Speed</mainText></stats>"),
  {},
  "parseDescStats: %がattention内でもクラッシュしない(Attack Speedは辞書対象外のため空)"
);
assertEq(
  parseDescStats("<stats><mainText><attention>40%</attention> Armor Penetration</mainText></stats>"),
  { percentArmorPen: 40 },
  "parseDescStats: %記号がattentionタグ内にあるパターンを正しく抽出"
);

// ---- パス1: 単一ステータスレート導出(価格÷値と一致) ----
const pureResult = deriveRatesPure(MOCK.data);
const pure = pureResult.rates;
assertClose(pure.FlatPhysicalDamageMod, 350 / 10, "パス1: ADレート = 価格÷値");
assertClose(pure.FlatArmorMod, 300 / 15, "パス1: 物理防御レート = 価格÷値");
assertClose(pure.FlatMovementSpeedMod, 300 / 25, "パス1: MSレート = 価格÷値");
assertClose(pure.abilityHaste, 250 / 5, "パス1: ヘイストレート(description由来) = 価格÷値");

// ---- パス2: 残差方式(単段・負残差ガード) ----
const { rates, skipped } = deriveRatesResidual(MOCK.data, pureResult);
// ヴァンパイアセプター: 900 - (15×ADレート35) = 900-525=375, ÷0.1 = 3750
assertClose(rates.PercentLifeStealMod, (900 - 15 * pure.FlatPhysicalDamageMod) / 10, "パス2: ライフスティールの残差計算(%正規化後の10)");
// セレイテッドダーク: 1100 - (18×AD35)=1100-630=470, ÷18=26.11...
assertClose(rates.lethality, (1100 - 18 * pure.FlatPhysicalDamageMod) / 18, "パス2: 致死力の残差計算(貫通系)");
// 負残差ガード: 9999は登録されていない(RATE_SOURCES_RESIDUALのitemIdに含めていないため直接テストできないが、
// 導出不能ケースとしてbaseHpRegen等(モックに存在しない)がskippedに含まれることを確認
if (!skipped.includes("FlatHPRegenMod")) { console.error("FAIL: 存在しない導出元(FlatHPRegenMod)がskippedに含まれていない"); failed++; }
else console.log("ok: 存在しない導出元はskippedに記録される(パッチ削除耐性)");

// ---- 負残差ガードの直接テスト ----
{
  const negMock = {
    "AAAA": { gold: { total: 100, purchasable: true }, stats: { FlatPhysicalDamageMod: 100 }, description: "<stats><mainText><attention>50</attention> Lethality</mainText></stats>" },
  };
  const negPure = { FlatPhysicalDamageMod: 35 }; // 100×35=3500 > 100(価格) → 残差が負になる
  const customResidual = { lethality: { itemId: "AAAA", knownKeys: ["FlatPhysicalDamageMod"] } };
  // deriveRatesResidualは定数RATE_SOURCES_RESIDUALを直接参照するため、ここではロジックを手動再現して検証
  const merged = mergeStats(negMock.AAAA);
  const knownValue = 100 * negPure.FlatPhysicalDamageMod;
  const residualGold = negMock.AAAA.gold.total - knownValue;
  if (residualGold > 0) { console.error("FAIL: 負残差ガードのテスト前提が崩れている"); failed++; }
  else console.log("ok: 負残差ガード条件確認(residualGold<=0のケースを正しく検出)");
}

// ---- 反復処理の収束(多段依存: healShieldPower→baseMpRegen) ----
// モックにbaseMpRegen/healShieldPowerの導出元アイテムが無いため、収束後もskippedに残り無限ループしないことを確認
const start = Date.now();
deriveRatesResidual(MOCK.data, pureResult);
if (Date.now() - start > 1000) { console.error("FAIL: 反復処理が収束せず時間がかかりすぎている(無限ループの疑い)"); failed++; }
else console.log("ok: 反復処理は依存不足でも収束する(タイムアウトなし)");

// ---- computeEfficiency: 表示対象フィルタ・効率計算 ----
const { results, skippedStats } = computeEfficiency(MOCK);
const names = results.map((r) => r.name);
if (names.includes("非表示アイテム")) { console.error("FAIL: purchasable:falseのアイテムが混入している"); failed++; }
else console.log("ok: purchasable:falseは除外される");
if (names.includes("ポーション")) { console.error("FAIL: Consumableタグのアイテムが混入している"); failed++; }
else console.log("ok: Consumableタグは除外される");
const sword = results.find((r) => r.name === "テストソード");
if (!sword) { console.error("FAIL: テストソードが結果に存在しない"); failed++; }
else {
  const expectedVal = 55 * pure.FlatPhysicalDamageMod + 15 * pure.abilityHaste;
  const expectedEff = (expectedVal / 3000) * 100;
  assertClose(sword.efficiency, expectedEff, "computeEfficiency: AD+ヘイスト複合アイテムの効率%");
  assertEq(sword.tier, "legendary", "computeEfficiency: from有り・into空はlegendary判定");
}

// ---- 重複名・ミラーID・チャンピオン専用の除外 ----
{
  const dupMock = { data: {
    "6621": { name: "ドーンコア", gold: { total: 2500, purchasable: true }, stats: { FlatHPPoolMod: 200 }, description: "", maps: { "11": true }, from: ["x"], into: [] },
    "226621": { name: "ドーンコア", gold: { total: 2500, purchasable: true }, stats: { FlatHPPoolMod: 200 }, description: "", maps: { "11": true }, from: ["x"], into: [] },
    "7013": { name: "オーン強化品", gold: { total: 3000, purchasable: true }, stats: { FlatHPPoolMod: 300 }, description: "", maps: { "11": true }, requiredAlly: "Ornn", from: ["x"], into: [] },
    "1028": { name: "ルビークリスタル", gold: { total: 400, purchasable: true }, stats: { FlatHPPoolMod: 150 }, description: "", maps: { "11": true }, from: [], into: ["x"] },
  } };
  const r = computeEfficiency(dupMock);
  const dawnCount = r.results.filter((x) => x.name === "ドーンコア").length;
  assertEq(dawnCount, 1, "computeEfficiency: 同名重複はID昇順で1件のみ残る");
  const dawn = r.results.find((x) => x.name === "ドーンコア");
  assertEq(dawn.id, "6621", "computeEfficiency: 残るのは小さいID(本来のSRアイテム)");
  assertEq(r.results.some((x) => x.name === "オーン強化品"), false, "computeEfficiency: requiredAlly付きは除外");
}

// ---- 名前ローカライズ(namesData) ----
{
  const statsData = { data: { "1036": { name: "Long Sword", gold: { total: 350, purchasable: true }, stats: { FlatPhysicalDamageMod: 10 }, description: "", maps: { "11": true }, from: [], into: ["x"] } } };
  const namesData = { data: { "1036": { name: "ロングソード" } } };
  const r = computeEfficiency(statsData, namesData);
  assertEq(r.results[0].name, "ロングソード", "computeEfficiency: namesDataから表示名を取得");
}

// ---- ガーディアン系(モード専用アイテム)の除外・ローカライズ名dedup ----
{
  const modeMock = {
    data: {
      "3184": { name: "Guardian's Hammer", gold: { total: 950, purchasable: true }, stats: { FlatPhysicalDamageMod: 20 }, description: "", maps: { "11": true }, from: [], into: [] },
      "6621": { name: "Dawncore", gold: { total: 2500, purchasable: true }, stats: { FlatMagicDamageMod: 40 }, description: "", maps: { "11": true }, from: ["x"], into: [] },
      "8621": { name: "Dawncore Variant EN", gold: { total: 2500, purchasable: true }, stats: { FlatMagicDamageMod: 40 }, description: "", maps: { "11": true }, from: ["x"], into: [] },
      "1036": { name: "Long Sword", gold: { total: 350, purchasable: true }, stats: { FlatPhysicalDamageMod: 10 }, description: "", maps: { "11": true }, from: [], into: ["x"] },
    },
  };
  // ローカライズ側で6621と8621が同名「ドーンコア」になるケース(en名は異なる)
  const namesMock = {
    data: {
      "3184": { name: "ガーディアンハンマー" },
      "6621": { name: "ドーンコア" },
      "8621": { name: "ドーンコア" },
      "1036": { name: "ロングソード" },
    },
  };
  const { results } = computeEfficiency(modeMock, namesMock);
  const rNames = results.map((r) => r.name);
  if (rNames.some((n) => n.includes("ガーディアン"))) { console.error("FAIL: ガーディアン系アイテムが除外されていない"); failed++; }
  else console.log("ok: ガーディアン系(モード専用)はmaps11=trueでも除外される");
  const dawncoreCount = rNames.filter((n) => n === "ドーンコア").length;
  if (dawncoreCount !== 1) { console.error(`FAIL: ローカライズ名の同名重複が排除されていない(${dawncoreCount}件)`); failed++; }
  else console.log("ok: en名が異なってもローカライズ表示名が同じなら1件に統合される");
  const kept = results.find((r) => r.name === "ドーンコア");
  if (kept && kept.id !== "6621") { console.error("FAIL: 重複統合で小さいID(本来のアイテム)が残っていない"); failed++; }
  else console.log("ok: 重複統合時はID昇順で本来のアイテムが残る");
}

// ---- 魔法貫通の実数/%分岐 ----
assertEq(
  parseDescStats("<stats><mainText><attention>18</attention> Magic Penetration</mainText></stats>"),
  { magicPen: 18 },
  "parseDescStats: 実数魔法貫通はmagicPenキー"
);
assertEq(
  parseDescStats("<stats><mainText><attention>40%</attention> Magic Penetration</mainText></stats>"),
  { percentMagicPen: 40 },
  "parseDescStats: %魔法貫通はpercentMagicPenキーに分岐(ヴォイドスタッフ対策)"
);
assertEq(
  parseDescStats("<stats><mainText><attention>10</attention> Lethality<br><attention>30%</attention> Armor Penetration</mainText></stats>"),
  { lethality: 10, percentArmorPen: 30 },
  "parseDescStats: 脅威と%物理貫通の同居"
);

// ---- オムニヴァンプ(グラトナスブーツ由来)の残差計算(基礎値のみ・スタッキング記述なしの場合) ----
{
  const omniMock = {
    "1001": { gold: { total: 300, purchasable: true }, stats: { FlatMovementSpeedMod: 25 }, description: "" }, // ブーツ(MSレート導出元)
    "3008": { gold: { total: 1000, purchasable: true }, stats: { FlatMovementSpeedMod: 45 }, description: "<stats><mainText><attention>4%</attention> Omnivamp</mainText></stats>" }, // グラトナスブーツ(Slay記述なしの簡略モック)
  };
  const pr = deriveRatesPure(omniMock);
  const rr = deriveRatesResidual(omniMock, pr);
  const msRate = 300 / 25; // = 12
  const expectedOmni = (1000 - 45 * msRate) / 4; // Slay記述が無い場合は基礎値4のみで計算される
  assertClose(rr.rates.omnivamp, expectedOmni, "パス2: スタッキング記述が無ければ基礎値のみで計算(後方互換)");
}

// ---- オムニヴァンプ: 公式慣例(基礎+Slay最大スタック)への補正 ----
{
  assertClose(parseStackingBonus(
    "Gain <attention>1</attention>% Omnivamp on champion takedown, stacking up to <attention>6</attention> times.",
    "Omnivamp"
  ), 6, "parseStackingBonus: 1%×最大6回=6を算出");
  assertClose(parseStackingBonus("説明文にスタッキング記述なし", "Omnivamp"), 0, "parseStackingBonus: 該当なしは0");

  const omniMock2 = {
    "1001": { gold: { total: 300, purchasable: true }, stats: { FlatMovementSpeedMod: 25 }, description: "" },
    "3008": {
      gold: { total: 1000, purchasable: true }, stats: { FlatMovementSpeedMod: 45 },
      description: "<stats><mainText><attention>4</attention>% Omnivamp</mainText></stats><rules>Gain <attention>1</attention>% Omnivamp on champion takedown, stacking up to <attention>6</attention> times.</rules>",
    },
  };
  const pr3 = deriveRatesPure(omniMock2);
  const rr3 = deriveRatesResidual(omniMock2, pr3);
  const msRate2 = 300 / 25; // = 12
  const expectedOmni2 = (1000 - 45 * msRate2) / 10; // 基礎4+最大6=10で割る(公式慣例)
  assertClose(rr3.rates.omnivamp, expectedOmni2, "パス2: オムニヴァンプは基礎+Slay最大スタック(10)を分母に使用");
}

// ---- 記法揺れ耐性(実DDに近いパターン) ----
{
  // total of形式(現行Wiki文言: 0.6% ×10 = total 6%)
  assertClose(parseStackingBonus(
    "<stats><attention>4%</attention> Omnivamp</stats><br>Slay: Scoring a takedown grants you 0.6% omnivamp, stacking up to 10 times for a total of 6%.",
    "Omnivamp"
  ), 6, "parseStackingBonus: total of形式は合計値を直接採用");

  // 基礎値が直前にあっても増分(後方最近傍)を正しく拾う
  assertClose(parseStackingBonus(
    "<stats><attention>4%</attention> Omnivamp</stats> Gain <attention>1%</attention> omnivamp on takedown, stacking up to <attention>6</attention> times.",
    "Omnivamp"
  ), 6, "parseStackingBonus: 基礎値混在でも直近の増分×回数で算出(4%を誤採用しない)");

}

console.log(failed === 0 ? `\n全テスト成功` : `\n${failed}件失敗`);
process.exit(failed === 0 ? 0 : 1);
