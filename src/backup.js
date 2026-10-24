// バックアップ(引継ぎ)用のJSON形式と、customstats 配下への書き込み内容への変換(純関数)。
// 単体テスト: node src/backup.test.mjs
// バックアップJSONの形式。version 1(形式名なし)は players / matches / customChamps のみの旧形式。
export const BACKUP_FORMAT = "crl-backup";
export const BACKUP_VERSION = 2;

// 全データを1つのJSONにまとめる。session は当日限りの一時データ、fearless(単独ドラフト)は試合ごとの一時データなので含めない。
// cup(大会記録)は残したいデータなので含める
export function buildBackup({ players, matches, customChamps, settings, requests, rankRequests, cup }) {
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: Date.now(),
    players, matches, customChamps, settings, requests, rankRequests, cup: cup || null,
  };
}

// バックアップJSONを customstats 配下のノード単位の書き込み内容へ変換する。不正なら null。
// 旧形式は players / matches / champions だけを返し、他のノードには触れない。
export function backupToNodes(d) {
  if (!d || !Array.isArray(d.players) || !Array.isArray(d.matches)) return null;
  const byId = (arr) => Object.fromEntries((Array.isArray(arr) ? arr : []).filter((x) => x && x.id).map((x) => [x.id, x]));
  const nodes = {
    players: d.players,
    matches: byId(d.matches),
    champions: Array.isArray(d.customChamps) ? d.customChamps : [],
  };
  if (d.format === BACKUP_FORMAT && d.version >= 2) {
    // 移転先は旧サイト固有の値なので持ち込まない(移転後に取ったバックアップで新サイトが移転案内になるのを防ぐ)
    const { movedTo, ...settings } = d.settings && typeof d.settings === "object" ? d.settings : {};
    nodes.settings = Object.keys(settings).length ? settings : null;
    nodes.requests = byId(d.requests);
    nodes.rankRequests = byId(d.rankRequests);
    // 大会記録は持っている時だけ書き戻す(大会タブ追加前のバックアップで既存の大会記録を消さない)
    if (d.cup && typeof d.cup === "object") nodes.cup = d.cup;
  }
  return nodes;
}
