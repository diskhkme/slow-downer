import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// WebView 기본 우클릭 메뉴(뒤로, 새로고침, 검사 등)를 막는다. 글자 입력 칸은 복사/붙여넣기용으로 남긴다
document.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement;
  const textInput = t instanceof HTMLInputElement && (t.type === "text" || t.type === "number");
  if (!textInput) e.preventDefault();
});

// 연습 중 실수로 눌러 재생이 끊기거나 창이 뜨지 않도록 브라우저 단축키를 막는다
// (새로고침, 인쇄, 찾기, 저장, 소스 보기, 뒤로/앞으로). 복사/붙여넣기 등은 그대로 둔다
const BLOCKED_CTRL_KEYS = new Set(["KeyR", "KeyP", "KeyF", "KeyG", "KeyS", "KeyU", "KeyJ", "KeyH"]);
window.addEventListener(
  "keydown",
  (e) => {
    const blocked =
      e.key === "F5" ||
      e.key === "F3" ||
      e.key === "F7" ||
      (e.ctrlKey && BLOCKED_CTRL_KEYS.has(e.code)) ||
      (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) ||
      e.key === "BrowserBack" ||
      e.key === "BrowserForward";
    if (blocked) e.preventDefault();
  },
  { capture: true },
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
