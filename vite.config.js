import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// ビルドごとのID。画面に埋め込み(__BUILD_ID__)、同じ値を version.json にも書き出す。
// 開いたままの端末は version.json と自分のIDを比べ、新しいバージョンの公開に気付いて再読み込みを促す
const BUILD_ID = new Date().toISOString();
const versionFile = () => ({
  name: "crl-version-file",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
  },
});

export default defineConfig({
  plugins: [react(), viteSingleFile(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  base: "./",
  build: {
    outDir: "docs",
  },
});
