import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/app.css";

const el = document.getElementById("root");
if (!el) throw new Error("缺少 #root 挂载点");

// 不使用 StrictMode：其开发期双重执行 effect 会导致音频被重复调度播放
createRoot(el).render(<App />);
