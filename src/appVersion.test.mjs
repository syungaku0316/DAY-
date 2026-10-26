// Node単体テスト（実行: node src/appVersion.test.mjs）
import { FEARLESS_DATA_VER, isNewDeploy, oldClientWrote } from "./appVersion.js";

let failed = 0;
function assert(cond, label) {
  if (!cond) { console.error(`FAIL: ${label}`); failed++; }
  else console.log(`ok: ${label}`);
}

// ---- 新しいバージョンの公開: 起動時と今の配信ファイルの識別子(ETag等)を比べる ----
assert(isNewDeploy("\"abc\"", "\"def\""), "識別子が変わったら新しいバージョン");
assert(!isNewDeploy("\"abc\"", "\"abc\""), "同じなら更新なし");
assert(!isNewDeploy(null, "\"def\"") && !isNewDeploy("\"abc\"", null) && !isNewDeploy("", ""), "識別子が取れない時は判定しない(誤って再読み込みを促さない)");

// ---- 古いバージョンの画面がドラフト盤面を書き換えたか ----
// 新しい画面は ver を付けて書く。古い画面は知らない項目を落として書くので ver が消える
const V = FEARLESS_DATA_VER;
assert(oldClientWrote(V, { draft: ["アーリ"] }), "ver付きだった盤面から ver が消えたら古い画面が書いた");
assert(!oldClientWrote(V, { draft: ["アーリ"], ver: V }), "ver が付いたままなら新しい画面");
assert(!oldClientWrote(V, null), "リセット(盤面ごと削除)は古い画面の書き込みではない");
assert(!oldClientWrote(null, { draft: [] }), "最初から ver が無い盤面は判定しない(新しい画面がまだ一度も書いていない)");

console.log(failed === 0 ? "\nすべて成功" : `\n${failed}件失敗`);
process.exit(failed === 0 ? 0 : 1);
