import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/drawer.css";
import "./styles/terminal.css";
import "./styles/panels.css";
import "./styles/modals.css";
import "./styles/resource-table.css";
import "./styles/legacy-overrides.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
