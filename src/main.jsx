import "./pageSource.js"; // 他のモジュールがDOMに触れる前にHTML原本を確保するため最初に読み込む
import React from "react";
import { createRoot } from "react-dom/client";
import CustomStats from "./CustomStats.jsx";
createRoot(document.getElementById("root")).render(<CustomStats />);
