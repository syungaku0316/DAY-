// スコアボード画像解析モジュール
// - KDA: 数字テンプレートマッチング(決定的・検証済み20/20)
// - チャンピオン: ポートレートをData Dragonアイコンと照合
import { DIGIT_TEMPLATES, TEMPLATE_SIZE } from "./digitTemplates.js";

const KDA_BAND = [0.63, 0.80];   // KDA列のx比率
const NAME_BAND = [0.13, 0.40];  // 名前列
const PORTRAIT_BAND = [0.100, 0.145]; // チャンピオンポートレート

/* ---------------- 画像ユーティリティ ---------------- */
export function fileToImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = rej;
    img.src = url;
  });
}

function grayInverted(img, x0, x1) {
  // 指定x比率帯を切り出し、反転グレースケールの2次元配列を返す
  const w = Math.round(img.width * (x1 - x0));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = img.height;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, Math.round(img.width * x0), 0, w, img.height, 0, 0, w, img.height);
  const d = ctx.getImageData(0, 0, w, img.height).data;
  const g = new Uint8Array(w * img.height);
  for (let i = 0; i < w * img.height; i++) {
    const lum = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    g[i] = 255 - lum; // 反転: 明るい文字→低値(暗)、暗い背景→高値(明)
  }
  return { g, w, h: img.height };
}

function detectRows({ g, w, h }, minDark = 3, minH = 8) {
  const rows = []; let inRow = false, start = 0;
  for (let y = 0; y < h; y++) {
    let cnt = 0;
    for (let x = 0; x < w; x++) if (g[y * w + x] < 140) cnt++; // 反転後: 文字=低値(暗)
    if (cnt > minDark && !inRow) { inRow = true; start = y; }
    else if (cnt <= minDark && inRow) {
      inRow = false;
      if (y - start >= minH) rows.push([start, y]);
    }
  }
  return rows;
}

function glyphsInRow({ g, w }, y0, y1) {
  const colSum = new Array(w).fill(0);
  for (let x = 0; x < w; x++)
    for (let y = y0; y < y1; y++) if (g[y * w + x] < 140) colSum[x]++;
  const blobs = []; let inB = false, bs = 0;
  for (let x = 0; x < w; x++) {
    if (colSum[x] > 0 && !inB) { inB = true; bs = x; }
    else if (colSum[x] === 0 && inB) { inB = false; blobs.push([bs, x]); }
  }
  if (inB) blobs.push([bs, w]);
  return blobs.map(([x0, x1]) => {
    let top = y1, bot = y0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++)
        if (g[y * w + x] < 140) { if (y < top) top = y; if (y > bot) bot = y; }
    return { x0, x1, y0: top, y1: bot + 1 };
  }).filter((b) => b.y1 > b.y0);
}

function normGlyph({ g, w }, box) {
  // 16x16に正規化し平均0/分散1のFloat32Arrayを返す(最近傍サンプリング)
  const S = TEMPLATE_SIZE;
  const out = new Float32Array(S * S);
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  for (let sy = 0; sy < S; sy++) {
    for (let sx = 0; sx < S; sx++) {
      const px = box.x0 + Math.min(bw - 1, Math.floor((sx / S) * bw));
      const py = box.y0 + Math.min(bh - 1, Math.floor((sy / S) * bh));
      out[sy * S + sx] = g[py * w + px]; // テンプレートと同じ反転画像基準(文字=低値)
    }
  }
  let mean = 0; for (const v of out) mean += v; mean /= out.length;
  let sd = 0; for (const v of out) sd += (v - mean) ** 2; sd = Math.sqrt(sd / out.length) + 1e-6;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mean) / sd;
  return out;
}

function classifyGlyph(vec, extraTemplates) {
  let best = -2, bc = "?";
  const consider = (ch, arr) => {
    let s = 0;
    for (let i = 0; i < vec.length; i++) s += vec[i] * (arr[i] / 40);
    s /= vec.length;
    if (s > best) { best = s; bc = ch; }
  };
  for (const [ch, list] of Object.entries(DIGIT_TEMPLATES)) list.forEach((t) => consider(ch, t));
  if (extraTemplates) for (const [ch, list] of Object.entries(extraTemplates)) list.forEach((t) => consider(ch, t));
  return { ch: bc, score: best };
}

/* ---------------- KDA解析 ---------------- */
// 検出行の内部をさらにサブライン(縦方向の文字帯)に分割する。
// ゲーム内スコアボードではKDA本体行と「15.0 KDA」等のサブ行が近接しており、
// 完全な空行を挟まず1行に併合される。その場合グリフが縦に混ざって崩壊するため、
// 行が高すぎる場合は明画素数の「谷」で再帰的に分割する。
function splitSublines(band, y0, y1) {
  const { g, w } = band;
  const cnt = [];
  for (let y = y0; y < y1; y++) {
    let c = 0;
    for (let x = 0; x < w; x++) if (g[y * w + x] < 140) c++;
    cnt.push(c);
  }
  const H = y1 - y0;
  if (H <= 22) return [[y0, y1]];
  // 中央60%の範囲で最小の谷を探し、十分深ければ分割
  const lo = Math.floor(H * 0.2), hi = Math.ceil(H * 0.8);
  let vi = lo;
  for (let i = lo; i < hi; i++) if (cnt[i] < cnt[vi]) vi = i;
  const peak = Math.max(...cnt);
  if (cnt[vi] > peak * 0.35) return [[y0, y1]]; // 谷が浅い=1行とみなす
  return [...splitSublines(band, y0, y0 + vi), ...splitSublines(band, y0 + vi + 1, y1)];
}

// スラッシュ2本をアンカーとしてKDAを抽出する。
// バンド内にアイテム欄の端やダメージ数値の一部が混入しても、
// スラッシュ近傍の連続した数字だけを拾うため誤読しない(遠い数字はギャップで除外)。
const SLASH_MIN_SCORE = 0.5;
const DIGIT_MIN_SCORE = 0.35;
export function extractKdaByAnchors(chars) {
  const sorted = [...chars].sort((a, b) => a.box.x0 - b.box.x0);
  const digitWidths = sorted.filter((c) => /\d/.test(c.ch)).map((c) => c.box.x1 - c.box.x0);
  const medW = digitWidths.length ? digitWidths.sort((a, b) => a - b)[Math.floor(digitWidths.length / 2)] : 8;
  const maxGap = Math.max(6, medW * 1.6);
  const slashes = sorted.map((c, i) => ({ c, i })).filter(({ c }) => c.ch === "/" && c.score >= SLASH_MIN_SCORE);

  const walkDigits = (fromIdx, dir) => {
    // fromIdx の隣から dir 方向に、ギャップが小さい数字を最大2つ収集
    const out = [];
    let prev = sorted[fromIdx];
    for (let i = fromIdx + dir; i >= 0 && i < sorted.length && out.length < 2; i += dir) {
      const c = sorted[i];
      const gap = dir > 0 ? c.box.x0 - prev.box.x1 : prev.box.x0 - c.box.x1;
      if (gap > maxGap) break;
      if (!/\d/.test(c.ch) || c.score < DIGIT_MIN_SCORE) break;
      out.push(c); prev = c;
    }
    return dir > 0 ? out : out.reverse();
  };

  let best = null;
  for (let a = 0; a < slashes.length; a++) {
    for (let b = a + 1; b < slashes.length; b++) {
      const s1 = slashes[a], s2 = slashes[b];
      // スラッシュ間: 全てが数字で1〜2個、かつ双方に隣接していること
      const mid = sorted.slice(s1.i + 1, s2.i);
      if (mid.length < 1 || mid.length > 2) continue;
      if (!mid.every((c) => /\d/.test(c.ch) && c.score >= DIGIT_MIN_SCORE)) continue;
      if (mid[0].box.x0 - s1.c.box.x1 > maxGap) continue;
      if (s2.c.box.x0 - mid[mid.length - 1].box.x1 > maxGap) continue;
      const left = walkDigits(s1.i, -1);
      const right = walkDigits(s2.i, 1);
      if (!left.length || !right.length) continue;
      const all = [...left, s1.c, ...mid, s2.c, ...right];
      const avg = all.reduce((s, c) => s + c.score, 0) / all.length;
      if (!best || avg > best.avg) {
        best = {
          avg,
          kda: [
            Number(left.map((c) => c.ch).join("")),
            Number(mid.map((c) => c.ch).join("")),
            Number(right.map((c) => c.ch).join("")),
          ],
        };
      }
    }
  }
  return best ? best.kda : null;
}

export function extractKda(chars) {
  const text = chars.map((c) => c.ch).join("");
  // 1) スラッシュアンカー方式を優先(混入ノイズに強く、クリーンな行でも同じ結果になる)
  const anchored = extractKdaByAnchors(chars);
  if (anchored) return { kda: anchored, text };
  // 2) フォールバック: 行全体が厳密に d/d/d の場合(スラッシュのスコアが低い等で1)が失敗した場合の保険)
  const strict = text.split("/").filter((s) => s !== "");
  if (strict.length === 3 && strict.every((p) => /^\d{1,2}$/.test(p))) {
    return { kda: strict.map(Number), text };
  }
  return { kda: null, text };
}

// バンド切り出し済みの反転グレースケールに対する解析本体(Nodeパリティテスト用に分離)
export function analyzeKdaGray(band, extraTemplates) {
  const rows = detectRows(band);
  const results = [];
  for (const [ry0, ry1] of rows) {
    // 行内をサブラインに分割し、KDAとして成立する最初のサブラインを採用
    const sublines = splitSublines(band, ry0, ry1);
    let picked = null;
    for (const [y0, y1] of sublines) {
      const glyphs = glyphsInRow(band, Math.max(0, y0 - 1), y1 + 1);
      const chars = glyphs.map((b) => ({ box: b, vec: normGlyph(band, b), ...classifyGlyph(normGlyph(band, b), extraTemplates) }));
      const { kda, text } = extractKda(chars);
      const cand = { yCenter: (y0 + y1) / 2, pitch: y1 - y0, text, kda, glyphVecs: chars.map((c) => Array.from(c.vec)) };
      if (kda) { picked = cand; break; }
      if (!picked) picked = cand; // 全滅時は先頭サブラインの情報を残す(デバッグ用)
    }
    results.push(picked);
  }
  return results;
}

export function analyzeKda(img, extraTemplates) {
  return analyzeKdaGray(grayInverted(img, KDA_BAND[0], KDA_BAND[1]), extraTemplates);
}

let tesseractPromise = null;


/* ---------------- チャンピオンアイコン照合 ---------------- */
const CHAMP_SIG_SIZE = 16; // 署名解像度(照合対象は最大170体程度なので計算量は問題ない)

function l2norm(v) {
  let mean = 0; for (const x of v) mean += x; mean /= v.length;
  let n = 0; const o = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) { o[i] = v[i] - mean; n += o[i] * o[i]; }
  n = Math.sqrt(n) + 1e-6;
  for (let i = 0; i < o.length; i++) o[i] /= n;
  return o;
}

// キャンバス上のS×S画像から正規化RGB署名ベクトルを生成(署名計算・照合クエリの両方で共用)
function sigFromCanvas(ctx, S) {
  const d = ctx.getImageData(0, 0, S, S).data;
  const v = new Float32Array(S * S * 3);
  for (let i = 0; i < S * S; i++) { v[i * 3] = d[i * 4]; v[i * 3 + 1] = d[i * 4 + 1]; v[i * 3 + 2] = d[i * 4 + 2]; }
  return l2norm(v);
}

let champSigsPromise = null;

// 信頼度の目安: l2norm後のコサイン類似度(-1〜1、1が完全一致)。
// 以前は閾値未満を空欄にしていたが、実地で全滅する(1つも入らない)ケースがあったため方針変更:
// 常に最良候補を返し、低信頼(low: true)のフラグだけ付けてUI側で警告表示する。
// 実データでの分布が未取得(開発環境がRiot CDNに接続不可)のため、閾値は暫定値。
const SIG_LOW_SCORE = 0.35;
const SIG_LOW_MARGIN = 0.015;

function bestMatch(q, sigs) {
  let best = -2, second = -2, bn = "";
  for (const s of sigs) {
    let dot = 0;
    for (let i = 0; i < q.length; i++) dot += q[i] * s.v[i];
    if (dot > best) { second = best; best = dot; bn = s.name; }
    else if (dot > second) { second = dot; }
  }
  return { name: bn, score: best, margin: best - second };
}


/* ---------------- あいまい一致 ---------------- */
function editDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}

const MATCH_THRESHOLD = 0.45;

function clean(s) {
  return (s || "").toLowerCase().replace(/[\s・.。、]/g, "");
}

function scoreCandidate(q, cand, penalty) {
  const c = clean(cand);
  if (!c) return null;
  const d = editDistance(q, c) / Math.max(q.length, c.length);
  const contains = c.includes(q) || q.includes(c);
  return d - (contains ? 0.3 : 0) + penalty;
}

// 選手1人分の最良スコアを返す(Riot IDのゲーム名部分を最優先、カード名は補助扱い)
function bestScoreForPlayer(q, p) {
  let best = null;
  const consider = (cand, penalty) => {
    const s = scoreCandidate(q, cand, penalty);
    if (s != null && (best == null || s < best)) best = s;
  };
  if (p.summonerName) {
    const gameName = p.summonerName.split("#")[0];
    consider(gameName, 0);       // Riot IDゲーム名: 最優先(ペナルティなし)
    consider(p.summonerName, 0); // タグ込み全体も念のため
  }
  consider(p.name, 0.10); // カード表示名: 補助(ペナルティ+0.10)
  return best;
}

// スコア付きで全選手中の最良候補を返す({player, score} | null)。opts.candidates指定時はplayerId集合内のみ照合

// 複数行のOCR名を一括照合し、同一選手が複数行に重複割当されないようgreedyに確定する
// rows: 文字列配列。opts.candidates: Set<playerId>(編成があればそのメンバーのみに限定)
// 戻り値: 各行に対応する { playerId, score } の配列(照合失敗行は { playerId: "", score: null })

/* ---------------- 縮小JPEG(承認用添付) ---------------- */
export function toThumbnailBase64(img, maxW = 900, quality = 0.6) {
  const scale = Math.min(1, maxW / img.width);
  const cv = document.createElement("canvas");
  cv.width = Math.round(img.width * scale);
  cv.height = Math.round(img.height * scale);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", quality);
}
