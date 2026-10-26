// Node単体テスト（実行: node src/draftTimer.test.mjs）
import { DRAFT_GRACE_MS, clockView, isAutoDue } from "./draftTimer.js";

let failed = 0;
function assert(cond, label) {
  if (!cond) { console.error(`FAIL: ${label}`); failed++; }
  else console.log(`ok: ${label}`);
}
const PHASE = 30000;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

assert(DRAFT_GRACE_MS === 3000, "猶予は3秒");

// ---- 表示: 持ち時間中は残り秒、0になったら猶予の残り秒 ----
assert(same(clockView(12300, PHASE), { sec: 13, inGrace: false, graceSec: 0 }), "持ち時間中: 残り12.3秒は13と表示");
assert(same(clockView(31000, PHASE), { sec: 30, inGrace: false, graceSec: 0 }), "持ち時間より大きく表示しない(端末の時計ずれ)");
assert(same(clockView(0, PHASE), { sec: 0, inGrace: true, graceSec: 3 }), "0秒ちょうどで猶予に入る(猶予3)");
assert(same(clockView(-1000, PHASE), { sec: 0, inGrace: true, graceSec: 2 }), "猶予1秒経過で残り2");
assert(same(clockView(-2999, PHASE), { sec: 0, inGrace: true, graceSec: 1 }), "猶予の最後の1秒");
assert(same(clockView(-5000, PHASE), { sec: 0, inGrace: false, graceSec: 0 }), "猶予を過ぎたら0のまま");

// ---- 自動処理(BANなし/ランダムPICK/ロールの自動確定)は猶予を過ぎてから ----
assert(!isAutoDue(0), "0秒ちょうどでは自動処理しない");
assert(!isAutoDue(-2999), "猶予中は自動処理しない(手番の人がまだ選べる)");
assert(isAutoDue(-3000), "猶予3秒を過ぎたら自動処理");
assert(isAutoDue(-2600, 500) && !isAutoDue(-2400, 500), "サーバー側の確認は端末の時計ずれ分(0.5秒)の余裕を持つ");

console.log(failed === 0 ? "\nすべて成功" : `\n${failed}件失敗`);
process.exit(failed === 0 ? 0 : 1);
