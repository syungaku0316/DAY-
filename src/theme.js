// theme.js — アプリ全体の配色・書体定義
//
// 実装方式: theme オブジェクトの各値は "var(--cs-xxx)" という文字列(CSS変数参照)。
// コンポーネント側は今まで通り theme.accent 等をそのまま使えば良く、
// 実際の色はブラウザ側の CSS変数(document.documentElement の --cs-*)から解決される。
// これにより、既存の数百箇所の theme.xxx 参照を一切書き換えずに
// 実行時のテーマ切替(色・書体)を実現している。

// ---- 色プリセット ----------------------------------------------------
export const THEME_PRESETS = {
  sky: {
    label: "空色（デフォルト）",
    bgFrom: "#D6E7F3", bgVia: "#CFE3F1", bgTo: "#C6DCEC",
    text: "#0F2A3D", textSub: "#4E6880", textFaint: "#8AA3B8",
    surface: "#FFFFFF", surfaceAlt: "#F1F6FA", surfaceWhite: "#FFFFFF",
    border: "#A9C4D8", borderInput: "#96B6CE", borderTable: "#DCE9F3",
    accent: "#0A5A8F", accentBright: "#1B7FBE", accentDeep: "#06436E", btnFrom: "#1B7FBE", btnTo: "#0A5A8F",
    teamB: "#C4551C",
    faintAccent: "#96BEDA", faintAccent2: "#85AECD",
    headAFrom: "#0F5F94", headATo: "#0F5F94",
    headBFrom: "#A8471A", headBTo: "#A8471A",
    badgeBg: "transparent",
    headNeutral: "#C3D6E4", headNeutralText: "#0F2A3D",
    profGreat: "#8A3FA0", profGood: "#1B7FBE", profFair: "#A67F14", profWeak: "#9AA3AD",
  },
  red: {
    label: "紅",
    bgFrom: "#ECDADA", bgVia: "#E9D5D5", bgTo: "#E7D0D0",
    text: "#420B0F", textSub: "#8F3D43", textFaint: "#BF7C80",
    surface: "#FFFFFF", surfaceAlt: "#FBEFEF", surfaceWhite: "#FFFBFB",
    border: "#E2B0B3", borderInput: "#D99799", borderTable: "#F6E6E7",
    accent: "#7A1218", accentBright: "#A82026", accentDeep: "#570A0F", btnFrom: "#A82026", btnTo: "#7A1218",
    teamB: "#135F86",
    faintAccent: "#DC9DA0", faintAccent2: "#CF8C8F",
    headAFrom: "#A82026", headATo: "#A82026", headBFrom: "#135F86", headBTo: "#135F86", badgeBg: "transparent",
    headNeutral: "#E0CBCC", headNeutralText: "#420B0F",
    profGreat: "#8A3FA0", profGood: "#A82026", profFair: "#A67F14", profWeak: "#9AA3AD",
  },
  green: {
    label: "若草",
    bgFrom: "#DAECDC", bgVia: "#D5E9D8", bgTo: "#D0E7D2",
    text: "#0B421A", textSub: "#3D8F53", textFaint: "#7CBF8C",
    surface: "#FFFFFF", surfaceAlt: "#EFFBF1", surfaceWhite: "#FBFFFC",
    border: "#B0E2B8", borderInput: "#97D9A2", borderTable: "#E6F6E9",
    accent: "#127A2E", accentBright: "#1DA844", accentDeep: "#0A5720", btnFrom: "#1DA844", btnTo: "#127A2E",
    teamB: "#C4551C",
    faintAccent: "#9DDCA8", faintAccent2: "#8CCF98",
    headAFrom: "#1DA844", headATo: "#1DA844", headBFrom: "#B44E18", headBTo: "#B44E18", badgeBg: "transparent",
    headNeutral: "#C6DCC9", headNeutralText: "#0B421A",
    profGreat: "#8A3FA0", profGood: "#1DA844", profFair: "#A67F14", profWeak: "#9AA3AD",
  },
  purple: {
    label: "藤",
    bgFrom: "#E2DAEC", bgVia: "#DDD5E9", bgTo: "#D8D0E7",
    text: "#250B42", textSub: "#653D8F", textFaint: "#9D7CBF",
    surface: "#FFFFFF", surfaceAlt: "#F5EFFB", surfaceWhite: "#FDFBFF",
    border: "#C7B0E2", borderInput: "#B597D9", borderTable: "#EDE6F6",
    accent: "#4E127A", accentBright: "#6D1DA8", accentDeep: "#390A57", btnFrom: "#6D1DA8", btnTo: "#4E127A",
    teamB: "#BE5A22",
    faintAccent: "#B99DDC", faintAccent2: "#A88CCF",
    headAFrom: "#6D1DA8", headATo: "#6D1DA8", headBFrom: "#B4571F", headBTo: "#B4571F", badgeBg: "transparent",
    headNeutral: "#CFC4DC", headNeutralText: "#250B42",
    profGreat: "#C93524", profGood: "#6D1DA8", profFair: "#A67F14", profWeak: "#9AA3AD",
  },
  yellow: {
    label: "山吹",
    bgFrom: "#EDE8D9", bgVia: "#EBE5D3", bgTo: "#E9E2CE",
    text: "#42310B", textSub: "#8F7A3D", textFaint: "#BFAD7C",
    surface: "#FFFFFF", surfaceAlt: "#FBF7EC", surfaceWhite: "#FFFEF9",
    border: "#E2D2A0", borderInput: "#D9C488", borderTable: "#F5EFDC",
    accent: "#8F6A00", accentBright: "#B8890A", accentDeep: "#6B4F00", btnFrom: "#B8890A", btnTo: "#8F6A00",
    teamB: "#135F86",
    faintAccent: "#DCCB9D", faintAccent2: "#CFBC8C",
    headAFrom: "#9C7A08", headATo: "#9C7A08", headBFrom: "#135F86", headBTo: "#135F86", badgeBg: "transparent",
    headNeutral: "#DCD3B9", headNeutralText: "#42310B",
    profGreat: "#8A3FA0", profGood: "#B8890A", profFair: "#C4551C", profWeak: "#9AA3AD",
  },
  orange: {
    label: "橙",
    bgFrom: "#EDE3D9", bgVia: "#EBDFD3", bgTo: "#E9DCCE",
    text: "#42220B", textSub: "#8F5F3D", textFaint: "#BF9A7C",
    surface: "#FFFFFF", surfaceAlt: "#FBF4EC", surfaceWhite: "#FFFDF9",
    border: "#E2C4A0", borderInput: "#D9B188", borderTable: "#F5EADC",
    accent: "#9C4A05", accentBright: "#C46312", accentDeep: "#753605", btnFrom: "#C46312", btnTo: "#9C4A05",
    teamB: "#135F86",
    faintAccent: "#DCBB9D", faintAccent2: "#CFAA8C",
    headAFrom: "#C46312", headATo: "#C46312", headBFrom: "#135F86", headBTo: "#135F86", badgeBg: "transparent",
    headNeutral: "#DCC9B4", headNeutralText: "#42220B",
    profGreat: "#8A3FA0", profGood: "#C46312", profFair: "#A67F14", profWeak: "#9AA3AD",
  },
  deepblue: {
    label: "濃紺",
    bgFrom: "#DAE1EC", bgVia: "#D5DDE9", bgTo: "#D0DAE7",
    text: "#0B2542", textSub: "#3D658F", textFaint: "#7C9DBF",
    surface: "#FFFFFF", surfaceAlt: "#EEF3FB", surfaceWhite: "#FCFDFF",
    border: "#B0C7E2", borderInput: "#97B5D9", borderTable: "#E6EDF6",
    accent: "#123E7A", accentBright: "#1D5AA8", accentDeep: "#0A2C57", btnFrom: "#1D5AA8", btnTo: "#123E7A",
    teamB: "#C9682F",
    faintAccent: "#9DB9DC", faintAccent2: "#8CA9CF",
    headAFrom: "#1D5AA8", headATo: "#1D5AA8", headBFrom: "#B4571F", headBTo: "#B4571F", badgeBg: "transparent",
    headNeutral: "#C2CDDE", headNeutralText: "#0B2542",
    profGreat: "#8A3FA0", profGood: "#1D5AA8", profFair: "#C99A1E", profWeak: "#9AA3AD",
  },
  dark: {
    label: "ダーク",
    bgFrom: "#1B222C", bgVia: "#171D26", bgTo: "#12161D",
    text: "#E8EDF2", textSub: "#A9B4C0", textFaint: "#6E7A87",
    surface: "#232B36", surfaceAlt: "#1E252F", surfaceWhite: "#2A323D",
    border: "#39434F", borderInput: "#465162", borderTable: "#2E3742",
    accent: "#4FA8E0", accentBright: "#6BC1F5", accentDeep: "#2E6FA0", btnFrom: "#6BC1F5", btnTo: "#4FA8E0",
    teamB: "#E2793F",
    faintAccent: "#3A4653", faintAccent2: "#333E4A",
    headAFrom: "#2E6FA0", headATo: "#2E6FA0", headBFrom: "#A8542A", headBTo: "#A8542A", badgeBg: "#E8EDF2",
    headNeutral: "#2A323D", headNeutralText: "#E8EDF2",
    profGreat: "#B571D9", profGood: "#6BC1F5", profFair: "#E0C15C", profWeak: "#7C8894",
  },
  sakura: {
    label: "桜",
    bgFrom: "#ECDAE1", bgVia: "#E9D5DD", bgTo: "#E7D0D9",
    text: "#420B22", textSub: "#8F3D5D", textFaint: "#BF7C97",
    surface: "#FFFFFF", surfaceAlt: "#FBEFF4", surfaceWhite: "#FFFBFD",
    border: "#E2B0C4", borderInput: "#D997B1", borderTable: "#F6E6ED",
    accent: "#8F1248", accentBright: "#B82064", accentDeep: "#6B0A34", btnFrom: "#B82064", btnTo: "#8F1248",
    teamB: "#0F6E86",
    faintAccent: "#DC9DB6", faintAccent2: "#CF8CA7",
    headAFrom: "#B82064", headATo: "#B82064", headBFrom: "#0F6E86", headBTo: "#0F6E86", badgeBg: "transparent",
    headNeutral: "#DFC7D2", headNeutralText: "#420B22",
    profGreat: "#8A3FA0", profGood: "#B82064", profFair: "#A67F14", profWeak: "#9AA3AD",
  },
  mint: {
    label: "青磁",
    bgFrom: "#DAECE7", bgVia: "#D5E9E4", bgTo: "#D0E6E0",
    text: "#08443B", textSub: "#379584", textFaint: "#6FB2A6",
    surface: "#FFFFFF", surfaceAlt: "#EDFAF6", surfaceWhite: "#FAFFFD",
    border: "#A5DED1", borderInput: "#8BD3C2", borderTable: "#DEF4ED",
    accent: "#067060", accentBright: "#0F9682", accentDeep: "#045246", btnFrom: "#0F9682", btnTo: "#067060",
    teamB: "#BE5A22",
    faintAccent: "#96D8C9", faintAccent2: "#85CBBB",
    headAFrom: "#0F9682", headATo: "#0F9682", headBFrom: "#A84E1C", headBTo: "#A84E1C", badgeBg: "transparent",
    headNeutral: "#BCD9D1", headNeutralText: "#08443B",
    profGreat: "#8A3FA0", profGood: "#0F9682", profFair: "#A67F14", profWeak: "#9AA3AD",
  },
  sumi: {
    label: "墨",
    bgFrom: "#E5E5E1", bgVia: "#E1E1DD", bgTo: "#DEDED9",
    text: "#282825", textSub: "#6A6A62", textFaint: "#8C8C83",
    surface: "#FFFFFF", surfaceAlt: "#F4F4F0", surfaceWhite: "#FCFCFA",
    border: "#CCCCC2", borderInput: "#BABAAF", borderTable: "#EBEBE6",
    accent: "#2A2A28", accentBright: "#474743", accentDeep: "#171716", btnFrom: "#474743", btnTo: "#2A2A28",
    teamB: "#A81E0A",
    faintAccent: "#C4C4BA", faintAccent2: "#B7B7AC",
    headAFrom: "#3A3A38", headATo: "#3A3A38", headBFrom: "#9A1B09", headBTo: "#9A1B09", badgeBg: "transparent",
    headNeutral: "#D6D6CE", headNeutralText: "#282825",
    profGreat: "#6E4A85", profGood: "#3E6690", profFair: "#8A6C0C", profWeak: "#9AA3AD",
  },
  midnight: {
    label: "宵闇（ダーク紺）",
    bgFrom: "#161B28", bgVia: "#121724", bgTo: "#0D111B",
    text: "#E5EAF4", textSub: "#A2AECB", textFaint: "#66738F",
    surface: "#1D2434", surfaceAlt: "#181F2D", surfaceWhite: "#242C3F",
    border: "#333F58", borderInput: "#3F4D6C", borderTable: "#293349",
    accent: "#7C9EDB", accentBright: "#9AB8EC", accentDeep: "#4C6BA6", btnFrom: "#9AB8EC", btnTo: "#7C9EDB",
    teamB: "#E08A52",
    faintAccent: "#37425C", faintAccent2: "#303A52",
    headAFrom: "#3D5A8F", headATo: "#3D5A8F", headBFrom: "#A0562E", headBTo: "#A0562E", badgeBg: "#E5EAF4",
    headNeutral: "#242C3F", headNeutralText: "#E5EAF4",
    profGreat: "#BC85DD", profGood: "#9AB8EC", profFair: "#DFC26A", profWeak: "#7C8894",
  },
  nibi: {
    label: "鈍色（低刺激ライト）",
    bgFrom: "#E2E3E4", bgVia: "#DDDFE1", bgTo: "#D9DCDD",
    text: "#1F272D", textSub: "#5C6770", textFaint: "#98A3AB",
    surface: "#F0F2F3", surfaceAlt: "#E8EBEC", surfaceWhite: "#F3F5F6",
    border: "#C5CCD1", borderInput: "#B4BDC4", borderTable: "#E3E6E8",
    accent: "#35566F", accentBright: "#4A7290", accentDeep: "#284257", btnFrom: "#4A7290", btnTo: "#35566F",
    teamB: "#A3653E",
    faintAccent: "#BCC7CE", faintAccent2: "#AFBBC3",
    headAFrom: "#4E7089", headATo: "#4E7089", headBFrom: "#8F5636", headBTo: "#8F5636", badgeBg: "transparent",
    headNeutral: "#CBD2D7", headNeutralText: "#1F272D",
    profGreat: "#7E5E93", profGood: "#5F829B", profFair: "#9C8351", profWeak: "#9AA3AD",
  },
  kinari: {
    label: "生成り（紙）",
    bgFrom: "#E8E5DE", bgVia: "#E4E1DA", bgTo: "#E1DED6",
    text: "#2C2820", textSub: "#716B5B", textFaint: "#A39B87",
    surface: "#F3F0E7", surfaceAlt: "#ECE8DC", surfaceWhite: "#F6F3EB",
    border: "#D2CBB9", borderInput: "#C4BCA7", borderTable: "#E8E3D9",
    accent: "#5E5138", accentBright: "#7A6B4B", accentDeep: "#463C28", btnFrom: "#7A6B4B", btnTo: "#5E5138",
    teamB: "#8F5340",
    faintAccent: "#CCC4AF", faintAccent2: "#C0B7A0",
    headAFrom: "#70634A", headATo: "#70634A", headBFrom: "#7C4736", headBTo: "#7C4736", badgeBg: "transparent",
    headNeutral: "#D8D1C0", headNeutralText: "#2C2820",
    profGreat: "#7E5E93", profGood: "#6E7F5A", profFair: "#9C7B45", profWeak: "#9F988A",
  },
  susutake: {
    label: "煤竹（ダーク茶）",
    bgFrom: "#26211D", bgVia: "#211C19", bgTo: "#1A1613",
    text: "#E6E0D8", textSub: "#B2A99D", textFaint: "#786F64",
    surface: "#2E2823", surfaceAlt: "#28221E", surfaceWhite: "#362F29",
    border: "#453D35", borderInput: "#544A40", borderTable: "#39322B",
    accent: "#C3A26E", accentBright: "#D6B885", accentDeep: "#96794B", btnFrom: "#96794B", btnTo: "#96794B",
    teamB: "#C77A55",
    faintAccent: "#463E34", faintAccent2: "#3E362D",
    headAFrom: "#7A6444", headATo: "#7A6444", headBFrom: "#8F5638", headBTo: "#8F5638", badgeBg: "#E6E0D8",
    headNeutral: "#362F29", headNeutralText: "#E6E0D8",
    profGreat: "#B08BC6", profGood: "#D6B885", profFair: "#C9B25C", profWeak: "#8A8178",
  },
  koke: {
    label: "苔（ダーク緑）",
    bgFrom: "#1C231E", bgVia: "#171E19", bgTo: "#121813",
    text: "#DFE6DC", textSub: "#A4B1A0", textFaint: "#697566",
    surface: "#232C25", surfaceAlt: "#1E2620", surfaceWhite: "#2A342C",
    border: "#38453A", borderInput: "#445446", borderTable: "#2D392F",
    accent: "#8CAF85", accentBright: "#A3C69B", accentDeep: "#63855D", btnFrom: "#63855D", btnTo: "#63855D",
    teamB: "#C08857",
    faintAccent: "#39463B", faintAccent2: "#323E34",
    headAFrom: "#4E6B4A", headATo: "#4E6B4A", headBFrom: "#8F5F38", headBTo: "#8F5F38", badgeBg: "#DFE6DC",
    headNeutral: "#2A342C", headNeutralText: "#DFE6DC",
    profGreat: "#A98FC4", profGood: "#A3C69B", profFair: "#CCB964", profWeak: "#7E877B",
  },
};

// ---- 書体プリセット ----------------------------------------------------
export const FONT_PRESETS = {
  gothic: { label: "ゴシック体（デフォルト）", stack: "'Noto Sans JP','Hiragino Kaku Gothic ProN','Yu Gothic','Meiryo',sans-serif" },
  kyokasho: { label: "教科書体", stack: "'UD Digi Kyokasho NK-B','UD デジタル 教科書体 NK-B','Zen Maru Gothic',sans-serif" },
  mincho: { label: "明朝体", stack: "'Zen Old Mincho','Hiragino Mincho ProN','Yu Mincho',serif" },
  gyousho: { label: "行書", stack: "'Yuji Syuku','Zen Kurenaido',serif" },
  rounded: { label: "丸文字", stack: "'Klee One','Zen Maru Gothic',sans-serif" },
};

export const THEME_LIST = Object.keys(THEME_PRESETS).map((key) => ({ key, label: THEME_PRESETS[key].label }));
export const FONT_LIST = Object.keys(FONT_PRESETS).map((key) => ({ key, label: FONT_PRESETS[key].label }));

// コンポーネント側が参照する theme オブジェクト: 各値はCSS変数参照文字列
const COLOR_KEYS = Object.keys(THEME_PRESETS.sky);
export const theme = {};
COLOR_KEYS.forEach((k) => { if (k !== "label") theme[k] = `var(--cs-${k})`; });

// 実際にCSS変数へ値を書き込む(テーマ切替時・初期化時に呼ぶ)
export function applyTheme(colorKey, fontKey) {
  const c = THEME_PRESETS[colorKey] || THEME_PRESETS.sky;
  const f = FONT_PRESETS[fontKey] || FONT_PRESETS.gothic;
  const root = document.documentElement.style;
  COLOR_KEYS.forEach((k) => { if (k !== "label") root.setProperty(`--cs-${k}`, c[k]); });
  root.setProperty("--cs-font", f.stack);
}

export const WIN_BADGE_IMG = "data:image/png;base64,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";
export const LOSE_BADGE_IMG = "data:image/png;base64,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";
