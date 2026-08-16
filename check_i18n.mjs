// i18n総合検証: 重複キー・3言語不一致・プレースホルダ不一致・未定義参照・未使用キーを機械チェック
// 実行: node check_i18n.mjs
// 注意: 重複キーはJSのオブジェクトリテラル仕様で「後勝ち」になり、
//       追加したはずの訳が既存定義に静かに上書きされる。目視では気付けないため必ずこれで検査する。
import fs from "fs";
import { DICT } from "./src/i18n.js";

const raw = fs.readFileSync("./src/i18n.js", "utf8");
const jsx = fs.readFileSync("./src/CustomStats.jsx", "utf8");
let failed = 0;
const fail = (msg) => { console.error("NG: " + msg); failed++; };

// 1. 重複キー(言語ブロックごと)
for (const lang of ["ja", "en", "ko"]) {
  const start = raw.indexOf(`  "${lang}": {`);
  const rest = raw.slice(start + 10);
  const nexts = ["ja", "en", "ko"].map((l) => rest.indexOf(`  "${l}": {`)).filter((i) => i >= 0);
  const block = rest.slice(0, nexts.length ? Math.min(...nexts) : rest.length);
  const keys = [...block.matchAll(/"([a-zA-Z]+\.\d+)":/g)].map((m) => m[1]);
  const seen = new Set(), dups = new Set();
  keys.forEach((k) => (seen.has(k) ? dups.add(k) : seen.add(k)));
  if (dups.size) fail(`${lang}に重複キー: ${[...dups].join(", ")}`);
}

// 2. 3言語のキー集合一致
const ja = Object.keys(DICT.ja), en = new Set(Object.keys(DICT.en)), ko = new Set(Object.keys(DICT.ko));
ja.filter((k) => !en.has(k)).forEach((k) => fail(`enに欠落: ${k}`));
ja.filter((k) => !ko.has(k)).forEach((k) => fail(`koに欠落: ${k}`));
Object.keys(DICT.en).filter((k) => !DICT.ja[k]).forEach((k) => fail(`jaに欠落(en側にあり): ${k}`));

// 3. プレースホルダ整合
const ph = (s) => (String(s).match(/\{(\w+)\}/g) || []).sort().join(",");
ja.forEach((k) => {
  if (ph(DICT.ja[k]) !== ph(DICT.en[k]) || ph(DICT.ja[k]) !== ph(DICT.ko[k])) {
    fail(`プレースホルダ不一致: ${k} ja[${ph(DICT.ja[k])}] en[${ph(DICT.en[k])}] ko[${ph(DICT.ko[k])}]`);
  }
});

// 4. リテラルエスケープ混入(\\nがそのまま表示されるバグ)
["ja", "en", "ko"].forEach((l) => ja.forEach((k) => {
  if (/\\[nt]/.test(DICT[l][k])) fail(`リテラルエスケープ残存: ${l}/${k}`);
}));

// 5. コードからの参照が定義されているか / 定義が使われているか
const usedT = new Set([...jsx.matchAll(/t\("([a-zA-Z]+\.\d+)"/g)].map((m) => m[1]));
const usedLit = new Set([...jsx.matchAll(/"([a-zA-Z]+\.\d+)"/g)].map((m) => m[1])); // 定数経由参照も拾う
[...usedT].filter((k) => !DICT.ja[k]).forEach((k) => fail(`コード参照だが未定義: ${k}`));
const unused = ja.filter((k) => !usedLit.has(k) && !k.startsWith("common."));
if (unused.length) console.warn("警告: 未使用キー -> " + unused.join(", "));

console.log(failed === 0 ? "OK: i18n検証パス" : `${failed}件の問題`);
process.exit(failed === 0 ? 0 : 1);
