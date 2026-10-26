// Node単体テスト（実行: node src/draftList.test.mjs）
import { usableFirst } from "./draftList.js";

let failed = 0;
function assert(cond, label) {
  if (!cond) { console.error(`FAIL: ${label}`); failed++; }
  else console.log(`ok: ${label}`);
}

// 50音順に並んだ一覧。使用済み(イ・エ)は下にまとめ、それぞれの中では元の順を保つ
const list = ["ア", "イ", "ウ", "エ", "オ"];
const used = new Set(["イ", "エ"]);
const out = usableFirst(list, (c) => !used.has(c));
assert(out.join() === "ア,ウ,オ,イ,エ", "使えるチャンピオンが先、使えないものは下にまとまる(各グループ内は元の順)");
assert(list.join() === "ア,イ,ウ,エ,オ", "元の配列は並べ替えない");
assert(usableFirst(list, () => true).join() === list.join(), "全部使えるなら順番は変わらない");
assert(usableFirst([], () => true).length === 0, "空の一覧");

console.log(failed === 0 ? "\nすべて成功" : `\n${failed}件失敗`);
process.exit(failed === 0 ? 0 : 1);
