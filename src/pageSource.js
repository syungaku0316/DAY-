// React描画前のHTML原本を保持する(引継ぎ用HTMLの生成に使う)。
// main.jsx で必ず最初に import すること。module script は文書の解析完了後に評価されるため、
// この時点では #root が空で、設定スクリプトとバンドル本体がそのまま残っている。
export const PAGE_SOURCE = typeof document !== "undefined"
  ? "<!DOCTYPE html>\n" + document.documentElement.outerHTML
  : "";
