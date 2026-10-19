import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// 禁用 WebView2 默认右键菜单（返回/刷新/另存为/检查）
window.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
