// 画面のバージョン違いの検出(純関数)。単体テスト: node src/appVersion.test.mjs
// ページを開いたままの端末は、再読み込みするまで古い画面のまま動く。ドラフトのように全端末が同じ盤面を
// 操作する機能では、古い画面が1台でもいると新しい動き(例: 時間切れ後の猶予)が効かなくなる。

// ドラフト盤面のデータ形式の版。新しい画面は書き込むたびに ver を付ける
export const FEARLESS_DATA_VER = 2;

// 起動時と今の配信ファイルの識別子(ETag / Last-Modified)を比べ、新しいバージョンが公開されたか。
// 識別子が取れない時は判定しない(誤って再読み込みを促さない)
export function isNewDeploy(initialTag, currentTag) {
  return !!initialTag && !!currentTag && initialTag !== currentTag;
}

// 古い画面がドラフト盤面を書き換えたか。古い画面は知らない項目(ver)を落として書くので、
// ver 付きだった盤面から ver が消えたら古い画面の書き込み。盤面ごとの削除(リセット)は除く
export function oldClientWrote(prevVer, curNode) {
  if (!curNode) return false;
  return prevVer === FEARLESS_DATA_VER && curNode.ver !== FEARLESS_DATA_VER;
}
