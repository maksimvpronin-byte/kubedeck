import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { restoreStoredThemePreference } from "./utils/theme";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/drawer.css";
import "./styles/terminal.css";
import "./styles/port-forward-panel.css";
import "./styles/command-palette.css";
import "./styles/audit-panel.css";
import "./styles/diagnostics-panels.css";
import "./styles/problems-panel.css";
import "./styles/panels.css";
import "./styles/related-panel.css";
import "./styles/modals.css";
import "./styles/resource-table.css";
import "./styles/resource-summary-polish.css";
import "./styles/drawer-controls-polish.css";
import "./styles/related-panel-polish.css";

restoreStoredThemePreference();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
