// フィアレスドラフトのチャンピオン一覧の並び(純関数)。単体テスト: node src/draftList.test.mjs

// 使えるチャンピオンを先、使えない(使用済み・この試合でBAN/PICK済み)ものを下にまとめる。
// それぞれの中では元の順(50音順など)を保つ
export function usableFirst(list, usable) {
  return [...list.filter(usable), ...list.filter((c) => !usable(c))];
}
