// フィアレスドラフトの持ち時間の判定(純関数)。単体テスト: node src/draftTimer.test.mjs
// remainMs = その手番の持ち時間の残り(ミリ秒)。0以下で持ち時間切れ。

// 持ち時間切れの後、自動処理(BANなし/ランダムPICK/ロールの自動確定)まで待つ猶予。
// 0秒ぎりぎりで押したのに自動処理が先に走る、を防ぐ
export const DRAFT_GRACE_MS = 3000;

// 画面表示: sec=持ち時間の残り秒(0〜持ち時間)、inGrace=猶予中か、graceSec=猶予の残り秒
export function clockView(remainMs, phaseLenMs) {
  const sec = Math.min(phaseLenMs / 1000, Math.max(0, Math.ceil(remainMs / 1000)));
  const inGrace = remainMs <= 0 && remainMs > -DRAFT_GRACE_MS;
  const graceSec = inGrace ? Math.ceil((remainMs + DRAFT_GRACE_MS) / 1000) : 0;
  return { sec, inGrace, graceSec };
}

// 自動処理してよいか(猶予を過ぎたか)。slackMs: サーバー上で確かめる時の、端末の時計ずれ分の余裕
export function isAutoDue(remainMs, slackMs = 0) {
  return remainMs + DRAFT_GRACE_MS <= slackMs;
}
