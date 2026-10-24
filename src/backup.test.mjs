// Node単体テスト（実行: node src/backup.test.mjs）
import { BACKUP_FORMAT, BACKUP_VERSION, buildBackup, backupToNodes } from "./backup.js";

let failed = 0;
function assert(cond, label) {
  if (!cond) { console.error(`FAIL: ${label}`); failed++; }
  else console.log(`ok: ${label}`);
}

const base = {
  players: [{ id: "p1" }], matches: [{ id: "m1" }], customChamps: ["X"],
  settings: { matchupWarnThreshold: 15, movedTo: "https://old" }, requests: [{ id: "r1", text: "a" }], rankRequests: [],
};
const cup = { activeId: "t1", tournaments: { t1: { meta: { id: "t1", name: "第1回" } } } };

// ---- 既存の形式 ----
const full = buildBackup({ ...base, cup });
assert(full.format === BACKUP_FORMAT && full.version === BACKUP_VERSION, "形式名とバージョン");
const nodes = backupToNodes(full);
assert(nodes.matches.m1 && nodes.players.length === 1 && nodes.champions[0] === "X", "試合はID単位、選手・チャンピオンはそのまま");
assert(nodes.settings && !("movedTo" in nodes.settings), "移転先は持ち込まない");
assert(backupToNodes({ players: [], matches: [] }) && !("settings" in backupToNodes({ players: [], matches: [] })), "旧形式は players/matches/champions だけ");
assert(backupToNodes({ players: {}, matches: [] }) === null, "不正な形式は null");

// ---- 大会記録(customstats/cup)もバックアップ・引継ぎの対象 ----
assert(full.cup && full.cup.tournaments.t1.meta.name === "第1回", "バックアップに大会記録が入る");
assert(nodes.cup && nodes.cup.activeId === "t1", "復元時に大会記録も書き戻す");
const noCup = backupToNodes(buildBackup({ ...base, cup: null }));
assert(!("cup" in noCup), "大会記録の無いバックアップでは既存の大会記録に触れない(消さない)");
assert(!("cup" in backupToNodes({ players: [], matches: [], cup })), "旧形式に紛れた cup は使わない");

console.log(failed === 0 ? "\nすべて成功" : `\n${failed}件失敗`);
process.exit(failed === 0 ? 0 : 1);
