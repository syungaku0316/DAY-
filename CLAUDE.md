# CRL (Custom Rift Ledger) — 開発ルール

LoLカスタム戦績管理アプリ。React + Vite + Firebase RTDB → 単一HTMLをGitHub Pagesで配信。日英韓3言語。

## COMMUNICATION_STYLE

超効率モード。前置き禁止。結論から。解説は求められた時だけ。終了時は "Done"。
確証のない情報は断定せず、推測である旨を明言する。
**誤った前提には根拠を示して指摘してよい。**

## 目的(設計判断の基準)

運営効率化ツールであると同時に **コミュニケーション装置**。
データをもとに会話が活性化することが求める成果。機能の採否は「会話を生むか」も基準になる。

---

## ★変更時の必須検証(この順で全て実行。失敗したら直して再実行)

```bash
# 1. 構文チェック
npx --yes esbuild src/CustomStats.jsx --loader:.jsx=jsx --jsx=automatic --bundle \
  --external:react --external:react-dom --external:firebase --external:lucide-react --external:recharts --outfile=/dev/null

# 2. tシャドーイング検証(@babel/parser 必須)
node check_shadowing.mjs

# 3. i18n総合検証
node check_i18n.mjs

# 4. 単体テスト(itemEfficiency.js を触った場合のみ)
node src/itemEfficiency.test.mjs

# 5. ビルド
npx vite build   # → dist/index.html(単一ファイル 約1.0MB)
```

Python等で一括置換した後は、必ず 1 → 5 の順で確認すること。

---

## 絶対規則

1. **変数名 `t` を新規コードで使わない** — 翻訳関数をシャドーイングし白画面クラッシュ(過去5件)
2. **i18nキーは採番前に `grep -n '"key.nnn"' src/i18n.js` で空き確認** — オブジェクトリテラルは後勝ちで訳が静かに消える
3. **i18n値に `\n` を含めない** — 改行はJS側で `[...].join("\n")`。二重エスケープ事故の元
4. **DB保存値は常に日本語** — rank / honorRank / champion 等。翻訳は表示層のみ
5. **`window.alert/confirm/prompt` 禁止** — `themedAlert` / `themedConfirm` / `themedPrompt`(Promise ベース)を使う。`requireAdminPass` は async なので必ず `await`
6. **チャンピオン名は保存時に `champCanonical()`** / 表示は `champLabel()`
7. **サイド表記は `sideLabel(side)` 経由**。文字列定数を新設しない
8. **Discordコピー文面は日本語固定**(UI言語に追従させない)
9. **OPGGのregionは `jp` 固定**(UI言語に追従させない)
10. **統計抽出は常に `en_US`**、表示名のみ現在ロケール(アイテム効率)
11. **韓国語表記**: 中黒は `·`(U+00B7)、括弧は半角、範囲は `~`
12. **`customstats/settings` は `session` と別ノード** — session クリアで消えないようにするため

---

## ソース構成

| ファイル | 行数 | 内容 |
|---|---|---|
| `src/CustomStats.jsx` | ~6800 | メイン(全UI・ロジック) |
| `src/i18n.js` | ~2050 | 3言語辞書 **664キー**完全一致 |
| `src/champNames.js` | - | チャンピオン名対訳 + champLabel/champCanonical |
| `src/itemEfficiency.js` | 275 | アイテム金銭効率の純粋計算 |
| `src/itemEfficiency.test.mjs` | 247 | 上記のNode単体テスト29件 |
| `src/scoreboardOcr.js` | 318 | KDA読み取り |
| `src/digitTemplates.js`, `src/theme.js` | - | 数字テンプレート、16テーマ |
| `src/pageSource.js` | - | 起動時のHTML原本(引継ぎ用HTMLの生成元)。**`main.jsx` の最初の import から動かさない** |
| `check_shadowing.mjs` / `check_i18n.mjs` | - | 検証スクリプト |

`index.html`(Viteエントリ)冒頭に FIREBASE_CONFIG と APP_CONFIG(adminPass / viewPass)。
**PASSはクライアント側の抑止力**であり秘匿性はない。実質的な防御はURLの非公開性とFirebaseルール。

## データモデル(`customstats/` 配下)

- **players**: `{id, name, summonerName, rank(日本語), baseMu, honorRank, status, adjust, prefRoles, ngRoles, roles:{TOP:{mu,sigma,prof,streak}...}, wins, losses, kdaHistory:[...], otp:{role, champion}}`
  - `ngRoles`: **最大3つ**(ランク「初心者」は無制限)。超過データは読み込み時にリセット(`migratePlayer`)
  - `otp`: 1人1体・ロール紐付け。本人(PASS不要)/管理者が設定。登録ロールに配置された時だけ自チームのバン保護枠へ自動反映(保存はせずライブ計算)
- **matches**: ID単位個別保存。`image` は承認/却下時に自動削除
- **session**: `{roster, prefs, resetAt, balance}` — クリア時に未知フィールドは落ちる
  - `balance.banProtect` = 手動宣言 `{A:[],B:[]}` / `balance.banProtectOff` = ✕で外したOTP分 `{A:[],B:[]}`
- **settings**: `{matchupWarnThreshold, matchupWarnLanes}` — 運用設定。session と分離
  - `matchupWarnLanes`: 格差レーン数がこれ以上で「組み直し推奨」警告(既定3)
  - `movedTo`: 移転先URL。設定時は全員に移転案内だけを表示(管理者はPASSで開ける)
- **rankRequests** / **champions**
- **fearless**: フィアレスドラフト(ハード方式)の一時データ。`{games:[[手×20],...], draft:[手...], starts:{手番:開始時刻}, timer, roles, rolesLocked, captains}`、1手=チャンピオン正規名 / BANなしは `"-"`。手順はトーナメントドラフト順(`DRAFT_ORDER`)。確定済み試合のピックが両チーム使用不可。**試合記録・レートとは無関係**、`session` とも別ノードで「シリーズをリセット」(管理者PASS)でのみ消える。トランザクションで手数/試合数が画面とずれていたら中止。読み書きは `normFearless` / `packFearless` 経由(RTDBの空文字・疎配列対策)
  - `timer`: `{turnAt}`(稼働中) / `{remain, pausedAt}`(一時停止中) / null。1手30秒(`DRAFT_TURN_MS`)、時間切れは BAN→BANなし / PICK→使用可能からランダム。全端末が自動実行を試み先着1台だけ確定(他は stale を黙殺)
  - `starts`: 各手番の時計の開始時刻。「1つ戻す」は戻した手番を元の開始時刻から継続し**持ち時間を延ばさない**(管理者の戻すのみ満タン)。再開時は停止時間分ずらす
  - **ロール宣言**: 20手後に `roles:{A:{枠0-4:ロール},B:{...}}` を各キャプテンが選択(チーム内重複は入れ替え)→「ロールを確定」。持ち時間30秒(`ROLE_PHASE_MS`)、時間切れは未選択を残りロールで埋めて両チーム確定。ロールは試合確定時に破棄(履歴に残さない)
  - `captains`: キャプテン制限。管理者PASSでサイド別4桁コードを発行(画面非表示・コピーのみ)、コード入力した端末(`getDeviceId`)だけがそのサイドの手番・ロールを操作可。開始/再開・試合確定はどちらかのキャプテンか管理者。**戻すは直前の手が自サイドの時だけ**(相手が次の手を打つまで)。一時停止・やり直し・ロール宣言中の戻す・試合確定の取り消しは管理者のみ。null=誰でも操作可(戻すの持ち時間据え置きは同じ)。時間切れの自動進行は権限不問。**登録済みサイドの乗っ取り不可**(端末変更は管理者の「登録解除」後に再登録)
- **requests**: 要望掲示板。`{id, text, author, authorId(端末ID), ts, status: open|considering|planned|done|declined, reply, repliedAt, votes:{端末ID:true}}`。投稿・賛同はPASS不要、回答・削除は管理者PASS。done/declined は `repliedAt` から30日で閲覧端末が自動削除

## 引継ぎ(`引継ぎ手順書.md`)

- エクスポートは完全バックアップ `{format:"crl-backup", version:2, players, matches, customChamps, settings, requests, rankRequests}`(一時データの session / fearless は対象外)。旧形式(version無し)のインポートは players / matches / champions のみ上書き
- 引継ぎ用HTML = `PAGE_SOURCE` の `window.FIREBASE_CONFIG = {...};` / `window.APP_CONFIG = {...};` を正規表現で差し替えたもの。**この2行の書式(`= {` と `};`)を変えない**
- 接続先未設定(`databaseURL` なし)で開くと `SetupScreen`(Firebase設定貼付 → PASS → JSON書込 → 設定済みHTML保存)
- Firebaseルールの正本は `database.rules.json`。変更時は `SETUP_RULES_JSON`(初期設定画面に表示)も揃える。`.validate` は削除時に評価されないため削除防止にはならない

## レーティング

TrueSkill簡易(勝敗のみ、KDA不使用)。MU0=60 / SIGMA_RATED=20 / SIGMA_UNRANKED=24 / SIGMA_FLOOR=8 / BETA=50/3 / TAU=0.6。
習熟度補正 ◎1.00 / 〇0.92 / △0.85 / ×0.75。順位表ソートは μ−σ。
`recomputeAll` は全試合を再生するため、**同卓した他選手のレートもわずかに動く**(正常挙動)。

編成スコア: `teamDiff + 0.5 × laneDiff − 0.05 × total`。
格差対策(`bestBalancedSplit`): 対面差 ≥ `matchupWarnThreshold` を格差レーンとし、優先順位は NG回避 → 格差レーン数が `matchupWarnLanes` に達する編成の回避 → 加重和(`+10×格差レーン数 + しきい値超過分 − 30×希望充足数`)。
NGレーンは **ハード制約**(`validPerms` で除外)。選手選出のタイブレークは低レート優先。
