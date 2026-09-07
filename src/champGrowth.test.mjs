// Node単体テスト（実行: node src/champGrowth.test.mjs）
import { growthCoef, statAt, attackSpeedAt, computeAt, MAX_LEVEL } from "./champGrowth.js";

let failed = 0;
function assertClose(actual, expected, label, eps = 1e-6) {
  if (Math.abs(actual - expected) > eps) { console.error(`FAIL: ${label} (actual=${actual}, expected=${expected})`); failed++; }
  else console.log(`ok: ${label}`);
}
function assert(cond, label) {
  if (!cond) { console.error(`FAIL: ${label}`); failed++; }
  else console.log(`ok: ${label}`);
}

// ---- growthCoef ----
assertClose(growthCoef(1), 0, "coef: Lv1 は 0");
assertClose(growthCoef(18), 17, "coef: Lv18 は 17");
assertClose(growthCoef(2), 0.72, "coef: Lv2 = 1×(0.7025+0.0175)");
assertClose(growthCoef(6), 5 * (0.7025 + 0.0175 * 5), "coef: Lv6");
assert(growthCoef(0) === 0, "coef: 下限クランプ");

// ---- statAt ----
assertClose(statAt(625, 106, 1), 625, "statAt: Lv1 は基礎値");
assertClose(statAt(625, 106, 18), 625 + 106 * 17, "statAt: Lv18 = base + growth×17");
assert(statAt(100, 10, 10) < statAt(100, 10, 1) + 10 * 9, "statAt: 線形より低い（非線形）");
for (let lv = 1; lv < 18; lv++) {
  assert(statAt(500, 90, lv + 1) > statAt(500, 90, lv), `statAt: 単調増加 Lv${lv}->${lv + 1}`);
}
assertClose(statAt(50, 0, 18), 50, "statAt: 成長0なら一定");

// ---- attackSpeedAt ----
// Graves: base 0.475 / ratio 0.49 / perLv 3
assertClose(attackSpeedAt(0.475, 0.49, 3, 1), 0.475, "AS: Lv1 は基礎AS");
assertClose(attackSpeedAt(0.475, 0.49, 3, 18), 0.475 + 0.49 * 0.03 * 17, "AS: Graves Lv18 ≈ 0.7249");
// ratio 未指定なら base で代用
assertClose(attackSpeedAt(0.625, 0, 2.5, 18), 0.625 + 0.625 * 0.025 * 17, "AS: ratio=0 は base 代用");
// 上限 2.5
assert(attackSpeedAt(0.7, 1.0, 50, 18) === 2.5, "AS: 上限 2.5 クランプ");

// ---- computeAt ----
const s = { hp: 625, hpPerLv: 106, mp: 325, mpPerLv: 40, ad: 66, adPerLv: 4, armor: 33, armorPerLv: 4.6,
  mr: 33, mrPerLv: 1.1, hp5: 8, hp5PerLv: 0.7, mp5: 8, mp5PerLv: 0.7, as: 0.475, asRatio: 0.49, asPerLv: 3, ms: 340, range: 425 };
const l1 = computeAt(s, 1), l18 = computeAt(s, 18);
assertClose(l1.hp, 625, "computeAt: Lv1 hp");
assertClose(l18.hp, 625 + 106 * 17, "computeAt: Lv18 hp");
assertClose(l18.ad, 66 + 4 * 17, "computeAt: Lv18 ad");
assertClose(l18.armor, 33 + 4.6 * 17, "computeAt: Lv18 armor");
assert(l1.ms === 340 && l18.ms === 340, "computeAt: ms は成長なし");
assert(l1.range === 425 && l18.range === 425, "computeAt: range は成長なし");
assertClose(l18.as, 0.475 + 0.49 * 0.03 * 17, "computeAt: Lv18 as");

assert(MAX_LEVEL === 18, "MAX_LEVEL");

console.log(failed === 0 ? "\nOK: champGrowth 全テストパス" : `\n${failed}件の失敗`);
process.exit(failed === 0 ? 0 : 1);
