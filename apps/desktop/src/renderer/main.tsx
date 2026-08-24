import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { completeBootStage } from "./bootProgress";
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
import "./styles/modals.css";
import "./styles/resource-table.css";
import "./styles/overview.css";
import "./styles/resource-summary.css";
import "./styles/drawer-controls.css";
import "./styles/related-panel.css";

restoreStoredThemePreference();
// Everything above is the bundle: modules, styles and the theme. The stages
// after this one are reported by useClusterController as they happen.
completeBootStage("ui");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
