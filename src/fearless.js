// フィアレス大会(チーム登録・対戦表・ピック記録・大会成績)の純粋計算。
// i18n / React / Firebase には依存しない。エラーは code で返し、文言化は UI 側で行う。
// ポイントはすべて 0.1pt 単位の整数(tenths)で合計・比較する(浮動小数の和で上限判定がぶれるのを防ぐ)。

export const FX_ROLES = ["TOP", "JG", "MID", "ADC", "SUP"];
export const MPLUS_RANKS = ["マスター", "グランドマスター", "チャレンジャー"];
export const DEFAULT_RULES = {
  pointCap: 430,
  maxMasterPlus: 1,
  maxSubs: 2,
  bestOf: { scrim: 3, main: 5, sf: 3, final: 5, third: 5 },
};
// Discordコピー用のステージ名(UI言語に関わらず日本語固定)
export const STAGE_JA = { scrim: "スクリム", main: "本番", sf1: "準決勝1", sf2: "準決勝2", final: "決勝", third: "3位決定戦" };

// ポイントは画面の表示値(toFixed(1))を正とする。Math.round(x*10) だと 0.15 のような値で表示(0.1)とずれるため toFixed を経由する
export const toTenths = (x) => Math.round(Number(Number(x || 0).toFixed(1)) * 10);
export const fmtTenths = (n) => (n / 10).toFixed(1);
// 表示値どうしの合計(0.1pt単位の整数)。「画面の数字を手で足した結果」と常に一致する
export const sumTenths = (values) => values.reduce((s, x) => s + toTenths(x), 0);

// チーム分け結果の枠(slot = {id, role, mu(編成時の値)})に出すレート。現在の選手データを優先し、
// 編成後に試合が承認されても選手一覧・対面格差の警告と食い違わないようにする。選手が消えていれば編成時の値
export function slotLiveMu(slot, players) {
  const p = players.find((x) => x.id === slot.id);
  const live = p?.roles?.[slot.role]?.mu;
  if (typeof live === "number") return live;
  return typeof slot.mu === "number" ? slot.mu : NaN;
}

// 選手の最高ロールとその値(0.1pt単位)。補欠候補など「どのロールに入るか未定」の表示に使う
export function bestRoleOf(player) {
  let best = null;
  FX_ROLES.forEach((r) => {
    const v = toTenths(player?.roles?.[r]?.mu);
    if (!best || v > best.tenths) best = { role: r, tenths: v };
  });
  return best;
}
const vals = (o) => (Array.isArray(o) ? o.filter(Boolean) : o && typeof o === "object" ? Object.values(o).filter(Boolean) : []);

// 管理画面の数値入力をそのまま受けるため、不正値は既定値に、範囲外は範囲内に丸める
export function normalizeRules(r) {
  const src = r || {};
  const num = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const cap = num(src.pointCap);
  const intIn = (v, lo, hi, d) => { const n = num(v); return n == null ? d : Math.min(hi, Math.max(lo, Math.round(n))); };
  const bo = {};
  Object.keys(DEFAULT_RULES.bestOf).forEach((k) => {
    const n = num(src.bestOf?.[k]);
    bo[k] = [1, 3, 5].includes(n) ? n : DEFAULT_RULES.bestOf[k];
  });
  return {
    pointCap: cap != null && cap > 0 ? cap : DEFAULT_RULES.pointCap,
    maxMasterPlus: intIn(src.maxMasterPlus, 0, 5, DEFAULT_RULES.maxMasterPlus),
    maxSubs: intIn(src.maxSubs, 0, 5, DEFAULT_RULES.maxSubs),
    bestOf: bo,
  };
}

// 登録受付中か。受付中だけチームの追加・削除ができ、締め切るまで試合は始められない(対戦表が確定しないため)。
// 手動の締切(entryClosed)と締切日時(entryDeadline)のどちらかで締め切る。試合開始後・大会終了後は常に締切扱い
export function isEntryOpen(meta, now = Date.now()) {
  if (!meta || meta.status !== "entry") return false;
  if (meta.entryClosed) return false;
  return !(meta.entryDeadline && now >= meta.entryDeadline);
}

/* ---------------- 選手・チーム ---------------- */

// 最高ランクはCRLに無いため、申告ランクか名誉レートで近似する。手動補正は team.mplus 側で行う
export function isMasterPlusAuto(player) {
  return !!player && (MPLUS_RANKS.includes(player.rank) || MPLUS_RANKS.includes(player.honorRank));
}

const roundPt = (mu) => toTenths(mu) / 10;
export function snapshotMember(player, role) {
  return { playerId: player.id, name: player.name, pts: roundPt(player.roles?.[role]?.mu) };
}
export function snapshotSub(player) {
  const pts = {};
  FX_ROLES.forEach((r) => { pts[r] = roundPt(player.roles?.[r]?.mu); });
  return { playerId: player.id, name: player.name, pts };
}

export const teamSubs = (team) => vals(team && team.subs);
export const isMplus = (team, playerId) => !!(team && team.mplus && team.mplus[playerId]);
export function teamPlayerIds(team) {
  const ids = FX_ROLES.map((r) => team?.members?.[r]?.playerId).filter(Boolean);
  return [...ids, ...teamSubs(team).map((s) => s.playerId)];
}
export function playerNameIn(team, playerId) {
  const m = FX_ROLES.map((r) => team?.members?.[r]).find((x) => x && x.playerId === playerId);
  if (m) return m.name;
  const s = teamSubs(team).find((x) => x.playerId === playerId);
  return s ? s.name : null;
}
export function starterLineup(team) {
  const lu = {};
  FX_ROLES.forEach((r) => { if (team?.members?.[r]?.playerId) lu[r] = team.members[r].playerId; });
  return lu;
}
// そのロールに入る選手のポイント(tenths)。先発は自ロールのみ、補欠は任意ロール。該当しなければ null
function slotTenths(team, role, playerId) {
  const m = team?.members?.[role];
  if (m && m.playerId === playerId) return toTenths(m.pts);
  const s = teamSubs(team).find((x) => x.playerId === playerId);
  if (s) return toTenths(s.pts?.[role]);
  return null;
}
export function lineupTenths(team, lineup) {
  return FX_ROLES.reduce((sum, r) => sum + (slotTenths(team, r, lineup?.[r]) ?? 0), 0);
}

export function validateTeam(team, rules, otherTeams = []) {
  const rl = normalizeRules(rules);
  const errors = [];
  const warnings = [];
  FX_ROLES.forEach((r) => { if (!team?.members?.[r]?.playerId) errors.push({ code: "slotEmpty", role: r }); });
  const subs = teamSubs(team);
  if (subs.length > rl.maxSubs) errors.push({ code: "tooManySubs", count: subs.length, max: rl.maxSubs });
  const ids = teamPlayerIds(team);
  const seen = new Set();
  ids.forEach((id) => {
    if (seen.has(id)) errors.push({ code: "dupInTeam", playerId: id });
    seen.add(id);
  });
  otherTeams.filter((o) => o && o.id !== team?.id && !o.eliminated).forEach((o) => {
    const theirs = new Set(teamPlayerIds(o));
    [...seen].forEach((id) => { if (theirs.has(id)) errors.push({ code: "dupOtherTeam", playerId: id, teamId: o.id }); });
  });
  const starters = starterLineup(team);
  const total10 = lineupTenths(team, starters);
  const cap10 = toTenths(rl.pointCap);
  if (total10 > cap10) errors.push({ code: "overCap", total10, cap10 });
  const mplusCount = Object.values(starters).filter((id) => isMplus(team, id)).length;
  if (mplusCount > rl.maxMasterPlus) errors.push({ code: "mplusOver", count: mplusCount, max: rl.maxMasterPlus });
  // 補欠が入ると上限/M+を超え得る組み合わせ(登録は可、警告のみ)
  subs.forEach((s) => {
    const overRoles = FX_ROLES.filter((r) => starters[r] && total10 - slotTenths(team, r, starters[r]) + toTenths(s.pts?.[r]) > cap10);
    if (overRoles.length) warnings.push({ code: "subOverRisk", playerId: s.playerId, roles: overRoles });
    if (isMplus(team, s.playerId) && mplusCount >= rl.maxMasterPlus) warnings.push({ code: "subMplusRisk", playerId: s.playerId });
  });
  return { ok: errors.length === 0, total10, remain10: cap10 - total10, cap10, mplusCount, errors, warnings };
}

// subRoleUsed: { playerId: role } — 同日の他の試合で補欠が出場したロール
export function validateLineup(team, lineup, rules, subRoleUsed = {}) {
  const rl = normalizeRules(rules);
  const errors = [];
  const seen = new Set();
  const subIds = new Set(teamSubs(team).map((s) => s.playerId));
  FX_ROLES.forEach((r) => {
    const id = lineup?.[r];
    if (!id) { errors.push({ code: "slotEmpty", role: r }); return; }
    if (seen.has(id)) errors.push({ code: "dupInLineup", playerId: id });
    seen.add(id);
    if (slotTenths(team, r, id) == null) errors.push({ code: "notInTeam", role: r, playerId: id });
    if (subIds.has(id) && subRoleUsed[id] && subRoleUsed[id] !== r) {
      errors.push({ code: "subRoleLocked", playerId: id, role: r, lockedRole: subRoleUsed[id] });
    }
  });
  const total10 = lineupTenths(team, lineup);
  const cap10 = toTenths(rl.pointCap);
  if (total10 > cap10) errors.push({ code: "overCap", total10, cap10 });
  const mplusCount = Object.values(lineup || {}).filter((id) => isMplus(team, id)).length;
  if (mplusCount > rl.maxMasterPlus) errors.push({ code: "mplusOver", count: mplusCount, max: rl.maxMasterPlus });
  return { ok: errors.length === 0, total10, cap10, mplusCount, errors };
}

/* ---------------- 対戦表 ---------------- */

// 抽選落ちを除き、seedOrder 順(未登録分は登録順)に並べる
export function orderTeams(teamsObj, seedOrder) {
  const order = Array.isArray(seedOrder) ? seedOrder : vals(seedOrder);
  const idx = (id) => { const i = order.indexOf(id); return i === -1 ? Infinity : i; };
  return vals(teamsObj).filter((tm) => !tm.eliminated)
    .sort((a, b) => idx(a.id) - idx(b.id) || (a.createdAt || 0) - (b.createdAt || 0));
}

// 募集文どおり: 2チーム=スクリム+本番 / 4チーム=トーナメント / それ以外=抽選待ち
export function buildSchedule(orderedTeams, rules) {
  const bo = normalizeRules(rules).bestOf;
  const ids = orderedTeams.map((tm) => tm.id);
  const n = ids.length;
  if (n <= 1) return { mode: "none", series: [] };
  if (n === 3) return { mode: "draw", drawTo: 2, series: [] };
  if (n >= 5) return { mode: "draw", drawTo: 4, series: [] };
  if (n === 2) {
    return { mode: "duo", series: [
      { key: "scrim", stage: "scrim", day: 1, bestOf: bo.scrim, a: ids[0], b: ids[1] },
      { key: "main", stage: "main", day: 2, bestOf: bo.main, a: ids[0], b: ids[1] },
    ] };
  }
  return { mode: "se4", series: [
    { key: "sf1", stage: "sf", day: 1, bestOf: bo.sf, a: ids[0], b: ids[3] },
    { key: "sf2", stage: "sf", day: 1, bestOf: bo.sf, a: ids[1], b: ids[2] },
    { key: "final", stage: "final", day: 2, bestOf: bo.final, a: null, b: null,
      from: { a: { key: "sf1", take: "winner" }, b: { key: "sf2", take: "winner" } } },
    { key: "third", stage: "third", day: 2, bestOf: bo.third, a: null, b: null,
      from: { a: { key: "sf1", take: "loser" }, b: { key: "sf2", take: "loser" } } },
  ] };
}

export const gameList = (gamesObj) => vals(gamesObj).sort((a, b) => (a.no || 0) - (b.no || 0));

export function seriesState(def, gamesObj) {
  const games = gameList(gamesObj);
  const winsA = def.a ? games.filter((g) => g.winner === def.a).length : 0;
  const winsB = def.b ? games.filter((g) => g.winner === def.b).length : 0;
  const need = Math.ceil((def.bestOf || 1) / 2);
  const winner = winsA >= need ? def.a : winsB >= need ? def.b : null;
  const loser = winner ? (winner === def.a ? def.b : def.a) : null;
  const lastNo = games.reduce((m, g) => Math.max(m, g.no || 0), 0);
  // 勝者未記録の試合がある間は次の試合へ進ませない(サイド選択権も勝敗数も決まらないため)
  const pending = winner ? null : games.find((g) => !g.winner);
  const pendingNo = pending ? pending.no : null;
  return { winsA, winsB, need, winner, loser, done: !!winner, pendingNo, nextNo: winner || pending ? null : lastNo + 1, games };
}

// seriesMap: { key: { games: {...} } }。決勝/3位決定戦の a/b を準決勝の結果で埋め、各シリーズに state を付ける
export function resolveBracket(series, seriesMap) {
  const out = [];
  const byKey = {};
  series.forEach((def) => {
    const d = { ...def };
    if (def.from) {
      const pick = (src) => {
        const s = byKey[src.key];
        if (!s || !s.state.done) return null;
        return src.take === "winner" ? s.state.winner : s.state.loser;
      };
      d.a = pick(def.from.a);
      d.b = pick(def.from.b);
    }
    d.state = seriesState(d, seriesMap?.[def.key]?.games);
    byKey[def.key] = d;
    out.push(d);
  });
  return out;
}

export function hasAnyResult(seriesMap) {
  return vals(seriesMap).some((s) => vals(s.games).length > 0);
}

// 最終順位。duo は本番のみで決める(スクリムは含めない)
export function finalPlacements(mode, resolved) {
  const get = (key) => resolved.find((s) => s.key === key);
  const res = {};
  const place = (s, first) => { if (s && s.state.done) { res[s.state.winner] = first; res[s.state.loser] = first + 1; } };
  if (mode === "duo") place(get("main"), 1);
  if (mode === "se4") { place(get("final"), 1); place(get("third"), 3); }
  return res;
}

/* ---------------- フィアレス ---------------- */

export function gamePicks(game) {
  const out = [];
  Object.entries(game?.picks || {}).forEach(([teamId, byRole]) => {
    FX_ROLES.forEach((r) => { if (byRole && byRole[r]) out.push({ teamId, role: r, champ: byRole[r] }); });
  });
  return out;
}

// 第 beforeNo 試合の時点で使用不可のチャンピオン(それ以前の試合で両チームがピックしたもの。BANは含めない)
export function fearlessLocked(gamesObj, beforeNo) {
  const set = new Set();
  gameList(gamesObj).filter((g) => (g.no || 0) < beforeNo).forEach((g) => gamePicks(g).forEach((p) => set.add(p.champ)));
  return set;
}

// 第 no 試合で選べないチャンピオン(その試合以外の全試合のピック)。
// 過去の試合を編集する時、後の試合で使ったチャンピオンに変えると後の試合がフィアレス違反になるため、前後とも除く
export function fearlessBlocked(gamesObj, no) {
  const set = new Set();
  gameList(gamesObj).filter((g) => g.no !== no).forEach((g) => gamePicks(g).forEach((p) => set.add(p.champ)));
  return set;
}

// ドラフトから反映した記録を、ドラフトのピックの組(10体)で特定する。
// ドラフトをリセットすると盤面上の試合番号は振り直されるため番号では照合しない。記録側を編集済みなら一致せず消さない
export function findDraftRecord(gamesObj, champs) {
  const key = [...champs].sort().join("|");
  return gameList(gamesObj).find((g) => g.draftIdx != null && gamePicks(g).map((p) => p.champ).sort().join("|") === key) || null;
}

// BAN等のチャンピオン名リスト入力を分割する。英語名("Miss Fortune")を割らないよう空白では区切らない
export function splitChampList(text) {
  return String(text || "").split(/[、,，/／\n]+/).map((x) => x.trim()).filter(Boolean);
}

// 使用済みチャンピオンの再ピック(過去試合を後から修正した場合など)と同一試合内の重複を検出
export function fearlessConflicts(gamesObj) {
  const out = [];
  gameList(gamesObj).forEach((g) => {
    const locked = fearlessLocked(gamesObj, g.no);
    const inGame = new Set();
    gamePicks(g).forEach((p) => {
      if (locked.has(p.champ) || inGame.has(p.champ)) out.push({ no: g.no, ...p });
      inGame.add(p.champ);
    });
  });
  return out;
}

// サイド選択権: 第1試合は null(ダイスBOT)、以降は前試合の敗者
export function sideChooser(gamesObj, no) {
  if (no <= 1) return null;
  const prev = gameList(gamesObj).find((g) => g.no === no - 1);
  if (!prev || !prev.winner) return null;
  return prev.winner === prev.blue ? prev.red : prev.winner === prev.red ? prev.blue : null;
}

// 同日の他試合で補欠が出場したロール { playerId: role }(exclude: 編集中の試合)
export function subRoleUsage(team, resolved, seriesMap, day, exclude) {
  const subIds = new Set(teamSubs(team).map((s) => s.playerId));
  const used = {};
  resolved.filter((s) => s.day === day).forEach((s) => {
    gameList(seriesMap?.[s.key]?.games).forEach((g) => {
      if (exclude && exclude.key === s.key && exclude.no === g.no) return;
      const lu = g.lineup?.[team.id];
      if (!lu) return;
      FX_ROLES.forEach((r) => { if (subIds.has(lu[r]) && !used[lu[r]]) used[lu[r]] = r; });
    });
  });
  return used;
}

/* ---------------- 大会成績 ---------------- */

export function tournamentStats(teamsObj, resolved, seriesMap) {
  const teams = {};
  vals(teamsObj).forEach((tm) => { teams[tm.id] = { teamId: tm.id, name: tm.name, sw: 0, sl: 0, gw: 0, gl: 0 }; });
  const players = {};
  const champs = {};
  const champRow = (c) => (champs[c] || (champs[c] = { champ: c, picks: 0, wins: 0, losses: 0, bans: 0 }));
  resolved.forEach((s) => {
    if (s.state.done) {
      if (teams[s.state.winner]) teams[s.state.winner].sw++;
      if (teams[s.state.loser]) teams[s.state.loser].sl++;
    }
    gameList(seriesMap?.[s.key]?.games).forEach((g) => {
      [g.blue, g.red].forEach((teamId) => {
        if (!teamId) return;
        const won = !!g.winner && g.winner === teamId;
        const lost = !!g.winner && g.winner !== teamId;
        if (teams[teamId]) { if (won) teams[teamId].gw++; if (lost) teams[teamId].gl++; }
        const tm = vals(teamsObj).find((x) => x.id === teamId);
        const lu = g.lineup?.[teamId] || {};
        FX_ROLES.forEach((r) => {
          const pid = lu[r];
          if (!pid) return;
          const row = players[pid] || (players[pid] = { playerId: pid, name: playerNameIn(tm, pid) || "?", teamId, games: 0, wins: 0, losses: 0, k: 0, d: 0, a: 0, kdaGames: 0, champs: {} });
          row.games++; if (won) row.wins++; if (lost) row.losses++;
          const kda = g.kda?.[pid];
          if (kda) { row.k += kda.k || 0; row.d += kda.d || 0; row.a += kda.a || 0; row.kdaGames++; }
          const c = g.picks?.[teamId]?.[r];
          if (c) {
            row.champs[c] = (row.champs[c] || 0) + 1;
            const cr = champRow(c); cr.picks++; if (won) cr.wins++; if (lost) cr.losses++;
          }
        });
        vals(g.bans?.[teamId]).forEach((c) => { champRow(c).bans++; });
      });
    });
  });
  return {
    teams: Object.values(teams),
    players: Object.values(players).sort((a, b) => b.games - a.games || b.wins - a.wins),
    champs: Object.values(champs).sort((a, b) => b.picks - a.picks || b.bans - a.bans),
  };
}

/* ---------------- 抽選 ---------------- */

export function drawSeeds(ids, rng = Math.random) {
  const arr = [...ids];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
export function drawSurvivors(ids, count, rng = Math.random) {
  return drawSeeds(ids, rng).slice(0, count);
}
