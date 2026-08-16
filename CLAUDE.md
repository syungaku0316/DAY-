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
| `src/CustomStats.jsx` | ~4367 | メイン(全UI・ロジック) |
| `src/i18n.js` | ~1330 | 3言語辞書 **424キー**完全一致 |
| `src/champNames.js` | - | チャンピオン名対訳 + champLabel/champCanonical |
| `src/itemEfficiency.js` | 275 | アイテム金銭効率の純粋計算 |
| `src/itemEfficiency.test.mjs` | 247 | 上記のNode単体テスト29件 |
| `src/scoreboardOcr.js` | 318 | KDA読み取り |
| `src/digitTemplates.js`, `src/theme.js` | - | 数字テンプレート、16テーマ |
| `check_shadowing.mjs` / `check_i18n.mjs` | - | 検証スクリプト |

`index.html`(Viteエントリ)冒頭に FIREBASE_CONFIG と APP_CONFIG(adminPass / viewPass)。
**PASSはクライアント側の抑止力**であり秘匿性はない。実質的な防御はURLの非公開性とFirebaseルール。

## データモデル(`customstats/` 配下)

- **players**: `{id, name, summonerName, rank(日本語), baseMu, honorRank, status, adjust, prefRoles, ngRoles, roles:{TOP:{mu,sigma,prof,streak}...}, wins, losses, kdaHistory:[...]}`
- **matches**: ID単位個別保存。`image` は承認/却下時に自動削除
- **session**: `{roster, prefs, resetAt, balance}` — クリア時に未知フィールドは落ちる
- **settings**: `{matchupWarnThreshold}` — 運用設定。session と分離
- **rankRequests** / **champions**

## レーティング

TrueSkill簡易(勝敗のみ、KDA不使用)。MU0=60 / SIGMA_RATED=20 / SIGMA_UNRANKED=24 / SIGMA_FLOOR=8 / BETA=50/3 / TAU=0.6。
習熟度補正 ◎1.00 / 〇0.92 / △0.85 / ×0.75。順位表ソートは μ−σ。
`recomputeAll` は全試合を再生するため、**同卓した他選手のレートもわずかに動く**(正常挙動)。

編成スコア: `teamDiff + 0.5 × laneDiff − 0.05 × total`。
NGレーンは **ハード制約**(`validPerms` で除外)。選手選出のタイブレークは低レート優先。
