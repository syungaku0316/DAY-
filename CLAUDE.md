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

# 4. 単体テスト(該当ファイルを触った場合のみ)
node src/itemEfficiency.test.mjs
node src/fearless.test.mjs
node src/rating.test.mjs
node src/backup.test.mjs
node src/lobby.test.mjs
node src/draftTimer.test.mjs
node src/draftList.test.mjs
node src/appVersion.test.mjs
node src/roleImpact.test.mjs

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
| `src/CustomStats.jsx` | ~8150 | メイン(全UI・ロジック) |
| `src/i18n.js` | ~2530 | 3言語辞書 **825キー**完全一致 |
| `src/rating.js` | - | レート計算(純関数): initRoles / computeLaneUpdate / applyMatchToPlayers / recomputeAll(承認済みのみ適用)/ validateMatchEntries / patchPlayerById |
| `src/rating.test.mjs` | - | 上記の単体テスト(現行の計算式の固定を含む) |
| `src/lobby.js` / `src/lobby.test.mjs` | - | 2試合同時マッチングの卓分け(実力順 tier / 混ぜる mix)と、組めない時の卓間入替候補 |
| `src/roleImpact.js` / `src/roleImpact.test.mjs` | - | ロール分析: 試合前レート(kdaHistory の μ−delta)から各試合のレーン差を復元し、対面で上回った側の勝率を集計 |
| `src/backup.js` / `src/backup.test.mjs` | - | バックアップJSON(大会記録 cup を含む)と復元用ノード変換 |
| `src/fearless.js` | 328 | フィアレス大会の純粋計算(ポイント検証・対戦表・ロック判定・成績)。i18n非依存、エラーはcodeで返す |
| `src/fearless.test.mjs` | 154 | 上記のNode単体テスト |
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

- **選手データ(players)の書き込みは必ず `updatePlayer` / `updateAllPlayers`(内部で `txPlayers` トランザクション)を使う**。手元の配列で全員分を `saveShared("players")` すると、同時に操作した他人の変更(出欠回答など)が消える
- 試合は報告・承認・編集の各時点で `validateMatchEntries`(5対5・チーム内ロール重複なし・同一選手重複なし)を通す

- **players**: `{id, name, summonerName, rank(日本語), baseMu, honorRank, status, adjust, prefRoles, ngRoles, roles:{TOP:{mu,sigma,prof,streak}...}, wins, losses, kdaHistory:[...], otp:{role, champion}}`
  - `ngRoles`: **最大3つ**(ランク「初心者」は無制限)。超過データは読み込み時にリセット(`migratePlayer`)
  - `otp`: 1人1体・ロール紐付け。本人(PASS不要)/管理者が設定。登録ロールに配置された時だけ自チームのバン保護枠へ自動反映(保存はせずライブ計算)
- **matches**: ID単位個別保存。`image` は承認/却下時に自動削除
- **session**: `{roster, prefs, resetAt, balance, balance2}`(balance2 = 第2試合。「2試合同時に編成」または「残りのメンバーで第2試合を編成」(第1試合の出場者を除いた出席者から10人)で作る。1試合の編成・事前固定の変更・クリアで null)。事前固定 `prefs[id].match`(1/2、未指定=1)で固定を使う試合を選ぶ。第2試合に固定した人は第1試合に入らない(`poolForMatch` / `isPinnedFor`)。2試合同時編成も固定を守る(`splitWithPins`)。固定の変更は影響する試合の結果だけ消す(`pinChangeClears`) — クリア時に未知フィールドは落ちる
  - `balance.banProtect` = 手動宣言 `{A:[],B:[]}` / `balance.banProtectOff` = ✕で外したOTP分 `{A:[],B:[]}`
- **settings**: `{matchupWarnThreshold, matchupWarnLanes}` — 運用設定。session と分離
  - `matchupWarnLanes`: 格差レーン数がこれ以上で「組み直し推奨」警告(既定3)
  - `movedTo`: 移転先URL。設定時は全員に移転案内だけを表示(管理者はPASSで開ける)
- **rankRequests** / **champions**
- **fearless**: フィアレスドラフト(ハード方式)の一時データ。`{games:[[手×20],...], draft:[手...], starts:{手番:開始時刻}, timer, roles, rolesLocked, captains}`、1手=チャンピオン正規名 / BANなしは `"-"`。手順はトーナメントドラフト順(`DRAFT_ORDER`)。確定済み試合のピックが両チーム使用不可。**試合記録・レートとは無関係**、`session` とも別ノードで「シリーズをリセット」(管理者PASS)でのみ消える。トランザクションで手数/試合数が画面とずれていたら中止。読み書きは `normFearless` / `packFearless` 経由(RTDBの空文字・疎配列対策)
  - `timer`: `{turnAt}`(稼働中) / `{remain, pausedAt}`(一時停止中) / null。1手30秒(`DRAFT_TURN_MS`)、時間切れから猶予3秒(`DRAFT_GRACE_MS`、`src/draftTimer.js`)の後に BAN→BANなし / PICK→使用可能からランダム(ロール宣言の自動確定も同じ)。猶予中は「時間切れ・猶予n秒」表示で手番の人はまだ選べる。**全端末が同じ盤面を操作するため、古い画面が1台でもいると新しい動きが効かない**: 盤面に `ver`(`FEARLESS_DATA_VER`)を付けて書き、古い画面が書いて ver が消えたら警告(`oldClientWrote`)。アプリ全体はビルドIDを `__BUILD_ID__` と `docs/version.json` に書き出し、2分ごと・画面表示時に比べて新しいバージョンの公開を知らせる全端末が自動実行を試み先着1台だけ確定(他は stale を黙殺)
  - `starts`: 各手番の時計の開始時刻。「1つ戻す」は戻した手番を元の開始時刻から継続し**持ち時間を延ばさない**(管理者の戻すのみ満タン)。再開時は停止時間分ずらす
  - **ロール宣言**: 20手後に `roles:{A:{枠0-4:ロール},B:{...}}` を各キャプテンが選択(チーム内重複は入れ替え)→「ロールを確定」。**両チーム確定まで相手には「?」表示**(見えるのは自サイドのキャプテンと、キャプテンでない管理者。制限なし時は非公開にできない。DB上は平文=抑止力)。持ち時間30秒(`ROLE_PHASE_MS`)、時間切れは未選択を残りロールで埋めて両チーム確定。ロールは試合確定時に破棄(履歴に残さない)
  - **手番の音**: 手数・試合数・完了状態の変化で Web Audio の合成音(`playTurnSound`、自チームの番は2音)。稼働中の残り5〜1秒は毎秒カウントダウン音(`playCountdownTick`、全端末)。初回読み込みでは鳴らさない。ON/OFFは端末ごと(localStorage `crl-fearless-sound`)。自動再生制限のため端末で一度操作するまで無音
  - `captains`: キャプテン制限。管理者PASSでサイド別4桁コードを発行(画面非表示・コピーのみ)、コード入力した端末(`getDeviceId`)だけがそのサイドの手番・ロールを操作可。開始/再開・試合確定はどちらかのキャプテンか管理者。**戻すは直前の手が自サイドの時だけ**(相手が次の手を打つまで)。一時停止・やり直し・ロール宣言中の戻す・試合確定の取り消しは管理者のみ。null=誰でも操作可(戻すの持ち時間据え置きは同じ)。時間切れの自動進行は権限不問。**登録済みサイドの乗っ取り不可**(端末変更は管理者の「登録解除」後に再登録)
- **requests**: 要望掲示板。`{id, text, author, authorId(端末ID), ts, status: open|considering|planned|done|declined, reply, repliedAt, votes:{端末ID:true}}`。投稿・賛同はPASS不要、回答・削除は管理者PASS。done/declined は `repliedAt` から30日で閲覧端末が自動削除
- **cup**: フィアレス大会(チーム登録・対戦表・大会成績)。`{activeId, tournaments/<tid>: {meta:{id,name,createdAt,status:entry|running|finished, entryClosed, entryDeadline}, rules:{pointCap,maxMasterPlus,maxSubs,bestOf}, teams/<id>:{name, members:{ROLE:{playerId,name,pts}}, subs:{pid:{playerId,name,pts:{ROLE}}}, mplus:{pid:true}, eliminated}, seedOrder:[], series/<key>/games/g<n>:{no,blue,red,winner,lineup,picks,bans,kda,draftIdx}, drafts/<key>:(fearless と同じ盤面形式 + blue)}}`
  - 大会用ドラフトは `FearlessDraftTab` を `path` / `cup` 付きで再利用。試合確定で `series/<key>/games` へ自動反映(`draftIdx` 付き、勝者は後で記録)。管理者の確定取り消しで反映分も削除
  - 登録受付(`isEntryOpen`): 受付中だけチームの追加・削除可、締切後は試合開始可(メンバー・補欠の編集は締切後も可)。再開は試合結果が無い間のみ
  - `pts` は登録時μのスナップショット(固定)。合計判定は0.1pt単位の整数で行う
  - 対戦表は保存せず teams+rules+seedOrder から導出(2チーム=scrim/main、4チーム=sf1/sf2/final/third、奇数等=抽選)
  - 大会の試合は `matches`・レート・戦績に**一切書き込まない**。閲覧・ビルダーはPASS不要、保存系は管理者PASS
  - UIは `CustomStats.jsx` 内(検証スクリプトの走査対象のため)。選手カードは `PlayerSlotCard` でマッチング結果と共用

## 引継ぎ(`引継ぎ手順書.md`)

- エクスポートは完全バックアップ `{format:"crl-backup", version:2, players, matches, customChamps, settings, requests, rankRequests}`(一時データの session / fearless は対象外)。旧形式(version無し)のインポートは players / matches / champions のみ上書き
- 引継ぎ用HTML = `PAGE_SOURCE` の `window.FIREBASE_CONFIG = {...};` / `window.APP_CONFIG = {...};` を正規表現で差し替えたもの。**この2行の書式(`= {` と `};`)を変えない**
- 接続先未設定(`databaseURL` なし)で開くと `SetupScreen`(Firebase設定貼付 → PASS → JSON書込 → 設定済みHTML保存)
- Firebaseルールの正本は `database.rules.json`。変更時は `SETUP_RULES_JSON`(初期設定画面に表示)も揃える。`.validate` は削除時に評価されないため削除防止にはならない

## レーティング

**ロール分析(データベース→ロール分析)**: ロール別勝率は1試合で各ロール1勝1敗が必ず入るため常に50%(無意味)。代わりに「対面で試合前レートが上回った側の勝率」を差の大きさ別・「そのロールだけ上回り他4レーン合計では劣勢」の試合別に出す。幅はWilson区間。選手削除やロール欠けの試合は除外して件数表示。「他4レーン劣勢」は他に `BIG_GAP_PT`(15pt)以上低いレーンがあるか(集中/分散)で分割。「組み合わせ表」(`pairMatrix`)は 行ロールで高く・列ロールで基準(10/15/20pt)以上低い試合の行側勝率(1試合が複数マスに入る)。試合一覧は15pt以上のレーンを含む試合に絞り込める。なお自動編成は格差レーン(15pt以上)を避けるため、大差の試合は少ない

TrueSkill簡易(勝敗のみ、KDA不使用)。MU0=60 / SIGMA_RATED=20 / SIGMA_UNRANKED=24 / SIGMA_FLOOR=8 / BETA=50/3 / TAU=0.6。
習熟度補正 ◎1.00 / 〇0.92 / △0.85 / ×0.75。順位表ソートは μ−σ。
`recomputeAll` は全試合を再生するため、**同卓した他選手のレートもわずかに動く**(正常挙動)。

**ポイント(μ)の合計・差・しきい値判定は画面の表示値(小数第1位)で行う**: `toTenths` / `sumTenths`(fearless.js、toFixed(1) 準拠)を使い、生のμを足して丸めない。チーム分けの計・レート差・対面格差、チームビルダー、大会の上限判定すべて共通。チーム分け結果の枠の値・計・レート差・レーン差は**現在のμ**(`slotLiveMu`、編成時の値は選手が消えた時の予備)

編成スコア: `teamDiff + 0.5 × laneDiff − 0.05 × total`。
格差対策(`bestBalancedSplit`): 対面差 ≥ `matchupWarnThreshold` を格差レーンとし、優先順位は NG回避 → 格差レーン数が `matchupWarnLanes` に達する編成の回避 → 加重和(`+10×格差レーン数 + しきい値超過分 − 30×希望充足数`)。
NGレーンは **ハード制約**(`validPerms` で除外)。選手選出のタイブレークは低レート優先。
