import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// 使用 React 18 的 createRoot API 挂载 React 应用。
// 通过在严格模式下渲染，可以捕捉潜在的副作用。
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
