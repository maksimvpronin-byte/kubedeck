const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const rendererRoot = path.resolve(__dirname, "../src/renderer");

function loadTypeScript(relativePath, stubs = {}) {
  const source = fs.readFileSync(path.join(rendererRoot, relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => {
    if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
    if (specifier === "react")
      return {
        useCallback: (value) => value,
        useEffect: () => undefined,
        useMemo: (value) => value(),
        useRef: (value) => ({ current: value }),
        useState: (value) => [typeof value === "function" ? value() : value, () => undefined],
      };
    if (specifier === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
    return {};
  };
  new Function("module", "exports", "require", output)(module, module.exports, localRequire);
  return module.exports;
}

test("cluster controller detects removal of the active cluster", () => {
  const model = loadTypeScript("hooks/useClusterController.ts");
  const active = { id: "cluster-a" };
  assert.equal(model.isActiveClusterConfigured(null, active), true);
  assert.equal(model.isActiveClusterConfigured({ clusters: [active], settings: {} }, active), true);
  assert.equal(model.isActiveClusterConfigured({ clusters: [{ id: "cluster-b" }], settings: {} }, active), false);
});

test("cluster ordering helper moves items without mutating the source", () => {
  const model = loadTypeScript("components/ClusterPanel.tsx", {
    "lucide-react": {
      ChevronDown: () => null,
      ChevronUp: () => null,
      GripVertical: () => null,
      Plus: () => null,
    },
  });
  const clusters = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(
    model.moveCluster(clusters, 2, 0).map((cluster) => cluster.id),
    ["c", "a", "b"],
  );
  assert.deepEqual(
    model.moveCluster(clusters, 0, 1).map((cluster) => cluster.id),
    ["b", "a", "c"],
  );
  assert.deepEqual(
    clusters.map((cluster) => cluster.id),
    ["a", "b", "c"],
  );
  assert.equal(model.moveCluster(clusters, 0, 0), clusters);
  assert.equal(model.moveCluster(clusters, -1, 0), clusters);
});

test("LLM renderer never fetches or submits Kubernetes logs", () => {
  const source = fs.readFileSync(path.join(rendererRoot, "components/LlmTab.tsx"), "utf8");
  assert.doesNotMatch(source, /\.podLogs\(|\.deploymentLogs\(/);
  assert.doesNotMatch(source, /previousLogs\s*:/);
  assert.doesNotMatch(source, /logs\s*:/);
});

test("the LLM answer language does not follow the UI language", () => {
  const source = fs.readFileSync(path.join(rendererRoot, "components/LlmTab.tsx"), "utf8");
  const types = fs.readFileSync(path.join(rendererRoot, "types.ts"), "utf8");
  // The analysis is always written in Russian. Sending the UI preference made
  // the answer switch to English, because "system" - the default - matched
  // neither branch of the prompt's language rule.
  assert.doesNotMatch(source, /language\s*:/);
  const request = types.slice(types.indexOf("export interface LlmAnalyzeResourceRequest"), types.indexOf("export interface LlmAnalyzeResourceResponse"));
  assert.doesNotMatch(request, /language/);
});

test("namespace selector keeps complete long names readable", () => {
  const component = fs.readFileSync(path.join(rendererRoot, "components/NamespaceSelector.tsx"), "utf8");
  const layout = fs.readFileSync(path.join(rendererRoot, "styles/layout.css"), "utf8");
  assert.match(component, /className="namespace-menu-label"/);
  assert.match(component, /title=\{namespace\}/);
  assert.match(layout, /\.namespace-menu\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;/s);
  assert.match(layout, /\.namespace-menu-options\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;/s);
  assert.match(layout, /\.namespace-menu-label\s*\{[^}]*min-width:\s*max-content;[^}]*white-space:\s*nowrap;/s);
  assert.doesNotMatch(layout, /\.namespace-menu\s*\{[^}]*max-width:/s);
  assert.doesNotMatch(layout, /\.namespace-menu-label\s*\{[^}]*(?:text-overflow|overflow-wrap):/s);
});

test("namespace search keeps selected namespaces visible", () => {
  const model = loadTypeScript("components/NamespaceSelector.tsx", {
    "lucide-react": { ChevronDown: () => null, Search: () => null, X: () => null },
  });
  const namespaces = ["default", "netshoot", "payments", "production"];
  assert.deepEqual(model.filterNamespaces(namespaces, ["netshoot"], "pay"), ["netshoot", "payments"]);
  assert.deepEqual(model.filterNamespaces(namespaces, ["payments"], "pay"), ["payments"]);
  assert.deepEqual(model.filterNamespaces(namespaces, ["netshoot"], ""), ["netshoot", "default", "payments", "production"]);
  assert.deepEqual(model.filterNamespaces(namespaces, [], "missing"), []);
});

test("an unchecked namespace keeps its place at the top of the open menu", () => {
  const model = loadTypeScript("components/NamespaceSelector.tsx", {
    "lucide-react": { ChevronDown: () => null, Search: () => null, X: () => null },
  });
  const namespaces = ["default", "netshoot", "payments", "production"];

  // Touched during this session, in the order they were touched — `production`
  // is still pinned after being unchecked, so re-checking it does not mean
  // hunting through the alphabetical list again.
  assert.deepEqual(model.pinnedNamespaces(namespaces, ["netshoot"], ["production", "netshoot"]), ["production", "netshoot"]);
  assert.deepEqual(model.filterNamespaces(namespaces, ["netshoot"], "", ["production", "netshoot"]), ["production", "netshoot", "default", "payments"]);

  // A selection that changed while the menu was open is still held at the top.
  assert.deepEqual(model.pinnedNamespaces(namespaces, ["payments"], ["netshoot"]), ["netshoot", "payments"]);

  // Selecting All keeps the block, so the previous choice stays one click away.
  assert.deepEqual(model.pinnedNamespaces(namespaces, ["all"], ["netshoot"]), ["netshoot"]);

  // Namespaces that no longer exist drop out, and the block never duplicates.
  assert.deepEqual(model.pinnedNamespaces(namespaces, ["netshoot"], ["removed", "netshoot", "netshoot"]), ["netshoot"]);

  // Without a pinned list the order is the plain selection, as before.
  assert.deepEqual(model.pinnedNamespaces(namespaces, ["netshoot"]), ["netshoot"]);
});

test("recently used namespaces stay on top until the retention window passes", () => {
  const model = loadTypeScript("utils/namespaceUsage.ts");
  const minute = 60_000;
  const start = 1_800_000_000_000;

  // Both sides of a change count as used: what stays selected and what was
  // just removed, so unchecking starts the countdown rather than ending it.
  let usage = model.rememberNamespaceUsage({}, ["payments"], start);
  usage = model.rememberNamespaceUsage(usage, ["payments", "netshoot"], start + 2 * minute);
  usage = model.rememberNamespaceUsage(usage, ["netshoot"], start + 5 * minute);

  // Most recent first, and `all`/`_cluster` are never recorded.
  usage = model.rememberNamespaceUsage(usage, ["all", "_cluster", ""], start + 6 * minute);
  assert.deepEqual(model.recentNamespaceOrder(usage, [], start + 6 * minute), ["netshoot", "payments"]);

  // Fourteen minutes after `payments` was last used it is still on top; two
  // minutes later it has aged out while `netshoot` has not.
  assert.deepEqual(model.recentNamespaceOrder(usage, [], start + 16 * minute), ["netshoot", "payments"]);
  assert.deepEqual(model.recentNamespaceOrder(usage, [], start + 18 * minute), ["netshoot"]);

  // Past the window everything falls back to the alphabetical list, except the
  // current selection, which is always reachable at the top.
  assert.deepEqual(model.recentNamespaceOrder(usage, [], start + 21 * minute), []);
  assert.deepEqual(model.recentNamespaceOrder(usage, ["production"], start + 21 * minute), ["production"]);

  // Writing prunes expired entries instead of letting the map grow.
  const pruned = model.rememberNamespaceUsage(usage, ["production"], start + 21 * minute);
  assert.deepEqual(Object.keys(pruned), ["production"]);

  // A missing map is treated as no history.
  assert.deepEqual(model.recentNamespaceOrder(undefined, ["netshoot"], start), ["netshoot"]);
});

test("the recent namespace block is capped without hiding the selection", () => {
  const model = loadTypeScript("utils/namespaceUsage.ts");
  const minute = 60_000;
  const start = 1_800_000_000_000;
  const eight = ["ns-1", "ns-2", "ns-3", "ns-4", "ns-5", "ns-6", "ns-7", "ns-8"];

  // Used one minute apart, so ns-8 is the most recent.
  let usage = {};
  eight.forEach((namespace, index) => {
    usage = model.rememberNamespaceUsage(usage, [namespace], start + index * minute);
  });
  const now = start + 8 * minute;

  // Only the five most recent are held above the alphabetical list.
  assert.deepEqual(model.recentNamespaceOrder(usage, [], now), ["ns-8", "ns-7", "ns-6", "ns-5", "ns-4"]);

  // A selected namespace is always held there, even past the cap, and does not
  // push a recent one out of its five slots.
  assert.deepEqual(model.recentNamespaceOrder(usage, ["ns-1"], now), ["ns-8", "ns-7", "ns-6", "ns-5", "ns-4", "ns-1"]);

  // Selecting more than the cap keeps every selected namespace visible.
  assert.deepEqual(model.recentNamespaceOrder(usage, eight, now), [...eight].reverse());

  // A selection with no recorded usage trails the recent ones.
  assert.deepEqual(model.recentNamespaceOrder(usage, ["fresh"], now), ["ns-8", "ns-7", "ns-6", "ns-5", "ns-4", "fresh"]);
});

test("manifest compare scrolls inside the modal and uses themed controls", () => {
  const component = fs.readFileSync(path.join(rendererRoot, "components/ManifestCompare.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(rendererRoot, "styles/modals.css"), "utf8");
  assert.match(component, /className="icon-text manifest-compare-mode"\s+type="button"/);
  assert.match(component, /\{raw \? "Raw" : "Clean"\}\s*<\/button>/);
  assert.match(component, /className="icon-button"\s+type="button"/);
  assert.match(styles, /\.manifest-compare\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.manifest-compare-grid\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.manifest-context\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.manifest-diff-code\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/s);
});

test("manifest compare marks equal, changed, added, and removed lines", () => {
  const model = loadTypeScript("components/ManifestCompare.tsx", { diff: require("diff"), yaml: require("yaml") });
  const rows = model.buildManifestDiff("same\nold\nleft-only\n", "same\nnew\nright-only\n");
  assert.equal(rows[0].leftTone, "equal");
  assert.equal(rows[0].rightTone, "equal");
  assert.ok(rows.some((row) => row.leftTone === "changed" && row.rightTone === "changed"));

  const removed = model.buildManifestDiff("same\nremoved\n", "same\n");
  assert.ok(removed.some((row) => row.leftTone === "removed"));
  const added = model.buildManifestDiff("same\n", "same\nadded\n");
  assert.ok(added.some((row) => row.rightTone === "added"));
  const uneven = model.buildManifestDiff("old\n", "new\nextra\n");
  assert.ok(uneven.some((row) => row.left === null && row.rightTone === "added"));
});

test("revealed text secrets edit immediately with themed safe confirmation", () => {
  const component = fs.readFileSync(path.join(rendererRoot, "components/SecretTab.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(rendererRoot, "styles/modals.css"), "utf8");
  assert.doesNotMatch(component, /window\.confirm|<Pencil|>Edit<\/button>/);
  assert.match(component, /if \(!data\.binary && !response\?\.immutable\)/);
  assert.match(component, /setDraft\(data\.value\)/);
  assert.match(component, /className="confirm-modal" role="dialog" aria-modal="true"/);
  assert.match(component, /The decoded value is not shown in this confirmation\./);
  assert.doesNotMatch(component, /<code>\{draft\}|<p>\{draft\}/);
  assert.match(styles, /\.secret-edit textarea\s*\{[^}]*background:\s*var\(--code-bg\);[^}]*color:\s*var\(--text\);[^}]*caret-color:\s*var\(--focus-ring\);/s);
});

test("clusters are switched from the icon rail instead of a topbar dropdown", () => {
  const component = fs.readFileSync(path.join(rendererRoot, "components/ClusterRail.tsx"), "utf8");
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  const layout = fs.readFileSync(path.join(rendererRoot, "styles/layout.css"), "utf8");
  const topbar = app.slice(app.indexOf('<header className="topbar">'), app.indexOf("<NamespaceSelector"));

  assert.equal(fs.existsSync(path.join(rendererRoot, "components/ClusterSelector.tsx")), false);
  assert.doesNotMatch(app, /ClusterSelector/);
  assert.doesNotMatch(topbar, /<select/);
  assert.match(app, /<ClusterRail/);
  // The rail sits left of the resource navigation and keeps the drawer guard.
  assert.ok(app.indexOf("<ClusterRail") < app.indexOf('<aside className="sidebar">'));
  assert.match(app, /onSelect=\{\(cluster\) => \{[\s\S]*?confirmDrawerNavigation\(\)[\s\S]*?openCluster\(cluster\)/);

  assert.doesNotMatch(component, /<select/);
  assert.match(component, /aria-current=\{active \? "true" : undefined\}/);
  assert.match(component, /event\.key === "ArrowDown"/);
  assert.match(component, /event\.key === "ArrowUp"/);
  assert.match(layout, /\.app-shell\s*\{[^}]*grid-template-columns:\s*var\(--cluster-rail-width[^}]*\}/s);
  assert.match(layout, /\.cluster-rail-item\.is-active/);
});

test("the kubeconfig editor reuses the YAML editor and never persists credentials", () => {
  const modal = fs.readFileSync(path.join(rendererRoot, "components/KubeconfigEditorModal.tsx"), "utf8");
  const yamlTab = fs.readFileSync(path.join(rendererRoot, "components/YamlTab.tsx"), "utf8");
  const editor = fs.readFileSync(path.join(rendererRoot, "components/YamlSourceEditor.tsx"), "utf8");
  const clusterPanel = fs.readFileSync(path.join(rendererRoot, "components/ClusterPanel.tsx"), "utf8");
  const api = fs.readFileSync(path.join(rendererRoot, "api.ts"), "utf8");

  // One highlighting implementation, used by both surfaces.
  assert.match(modal, /<YamlSourceEditor/);
  assert.match(yamlTab, /<YamlSourceEditor/);
  assert.doesNotMatch(yamlTab, /function highlightYaml\(/);
  assert.match(editor, /function highlightYaml\(/);

  // Kubeconfig content holds credentials: it must not reach persisted UI state.
  assert.doesNotMatch(modal, /saveUiState|localStorage|uiState/);
  // Saving is confirmed by typing the cluster name.
  assert.match(modal, /typedName\.trim\(\) !== cluster\.displayName/);
  assert.match(api, /saveClusterKubeconfig\(clusterId: string, content: string, typedName: string\)/);

  assert.match(clusterPanel, /clusters\.editKubeconfig/);
});

test("cluster rail initials stay short and readable", () => {
  const model = loadTypeScript("components/ClusterRail.tsx", { "lucide-react": { Plus: () => null } });
  assert.equal(model.clusterInitials("production"), "PR");
  assert.equal(model.clusterInitials("prod-eu-west"), "PE");
  assert.equal(model.clusterInitials("  staging cluster "), "SC");
  assert.equal(model.clusterInitials("k"), "K");
  assert.equal(model.clusterInitials(""), "?");
  assert.equal(model.clusterInitials("тест-кластер"), "ТК");
});

test("cluster rail labels the part of the name that differs", () => {
  const model = loadTypeScript("components/ClusterRail.tsx", { "lucide-react": { Plus: () => null } });
  const label = (clusters) => [...model.clusterRailLabels(clusters).values()];

  // Real-world naming: initials alone would read "K8" on almost every button.
  assert.deepEqual(label(["k8s1", "k8s2", "k8s7", "k8s-infr", "k8s-office"].map((displayName, index) => ({ id: `c${index}`, displayName }))), ["1", "2", "7", "IN", "OF"]);
  assert.deepEqual(
    label([
      { id: "a", displayName: "prod-eu" },
      { id: "b", displayName: "prod-us" },
    ]),
    ["EU", "US"],
  );
  // Without a shared prefix, or with a name that is only the prefix, initials stay.
  assert.deepEqual(
    label([
      { id: "a", displayName: "production" },
      { id: "b", displayName: "staging" },
    ]),
    ["PR", "ST"],
  );
  assert.deepEqual(
    label([
      { id: "a", displayName: "k8s" },
      { id: "b", displayName: "k8s1" },
    ]),
    ["K8", "K8"],
  );
  assert.deepEqual(label([{ id: "a", displayName: "k8s-office" }]), ["KO"]);

  // The accent hue is stable per cluster id and differs between clusters.
  assert.equal(model.clusterAccentHue("cluster-a"), model.clusterAccentHue("cluster-a"));
  assert.notEqual(model.clusterAccentHue("cluster-a"), model.clusterAccentHue("cluster-b"));
  assert.ok(model.clusterAccentHue("cluster-a") >= 0 && model.clusterAccentHue("cluster-a") < 360);
});

test("Pod Terminal delegates paste to the single xterm input path", () => {
  const source = fs.readFileSync(path.join(rendererRoot, "components/TerminalTab.tsx"), "utf8");
  const keyboardHandler = source.slice(source.indexOf("terminal.attachCustomKeyEventHandler"), source.indexOf("terminal.onSelectionChange"));

  assert.match(source, /terminal\.onData\(\(data\) => \{\s*sendTerminalInput\(socketRef\.current, data\);/s);
  assert.doesNotMatch(keyboardHandler, /paste|readText|sendTerminalInput/);
  assert.doesNotMatch(source, /addEventListener\("paste"/);
  assert.doesNotMatch(source, /navigator\.clipboard\?\.readText/);
});

test("Pod Terminal selectors use the themed in-app listbox", () => {
  const terminal = fs.readFileSync(path.join(rendererRoot, "components/TerminalTab.tsx"), "utf8");
  const select = fs.readFileSync(path.join(rendererRoot, "components/ThemedSelect.tsx"), "utf8");
  assert.doesNotMatch(terminal, /<select/);
  assert.match(terminal, /<ThemedSelect\s+ariaLabel="Container"/);
  assert.match(terminal, /<ThemedSelect\s+ariaLabel="Shell"/);
  assert.match(select, /role="listbox"/);
  assert.match(select, /role="option"/);
  assert.match(select, /window\.addEventListener\("pointerdown"/);
  assert.match(select, /event\.key === "Escape"/);
  assert.match(select, /event\.key === "ArrowDown"/);
  assert.match(select, /event\.key === "Home"/);
});

test("2.7.5 Manifest Compare uses the themed chooser and quota rows cannot overlap", () => {
  const compare = fs.readFileSync(path.join(rendererRoot, "components/ManifestCompare.tsx"), "utf8");
  const select = fs.readFileSync(path.join(rendererRoot, "components/ThemedSelect.tsx"), "utf8");
  const drawerStyles = fs.readFileSync(path.join(rendererRoot, "styles/drawer.css"), "utf8");
  assert.doesNotMatch(compare, /<select/);
  assert.match(compare, /<ThemedSelect/);
  assert.match(compare, /request === requestRef\.current/);
  assert.match(compare, /No comparable open resources/);
  assert.match(select, /role="listbox"/);
  assert.match(select, /aria-selected=\{isSelected\}/);
  assert.match(drawerStyles, /\.quota-usage\s*\{[^}]*container-type:\s*inline-size/s);
  assert.match(drawerStyles, /\.quota-usage-row\s*\{[^}]*grid-template-columns:/s);
  assert.match(drawerStyles, /@container \(max-width: 430px\)/);
  assert.match(drawerStyles, /overflow-wrap:\s*anywhere/);
});

test("2.7.4 resource surfaces stay compact and operational", () => {
  const drawer = fs.readFileSync(path.join(rendererRoot, "components/PodDrawer.tsx"), "utf8");
  const chrome = fs.readFileSync(path.join(rendererRoot, "components/PodDrawerChrome.tsx"), "utf8");
  const summary = fs.readFileSync(path.join(rendererRoot, "components/ResourceSummary.tsx"), "utf8");
  const table = fs.readFileSync(path.join(rendererRoot, "components/ResourceTable.tsx"), "utf8");
  const columns = fs.readFileSync(path.join(rendererRoot, "components/ResourceTableColumnsMenu.tsx"), "utf8");
  const terminal = fs.readFileSync(path.join(rendererRoot, "components/TerminalTab.tsx"), "utf8");

  assert.doesNotMatch(chrome, /\["events" as const\]/);
  assert.match(drawer, /const resolvedInitialTab: DrawerTab = drawerTabs\.includes\(initialTab\) \? initialTab : "summary";/);
  assert.match(drawer, /copyText\(pod\.name, "Name copied"\)/);
  assert.doesNotMatch(drawer, /copyText\(`\$\{resource\}\/\$\{pod\.name\}/);
  assert.match(chrome, /drawer-header-actions/);
  assert.match(chrome, /drawer-action-button/);
  assert.match(chrome, /data-tooltip=\{label\}/);
  assert.doesNotMatch(summary, /Object\.entries\(row\)/);
  assert.match(summary, /String\(event\.type \|\| ""\)\.toLowerCase\(\) !== "warning"/);
  assert.doesNotMatch(table, /<AsyncActionButton/);
  assert.match(table, /className=\{`phase-value is-\$\{kubernetesStatusTone\(row\)\}`\}/);
  assert.doesNotMatch(table, /className="cell-hint"/);
  assert.match(columns, /aria-label="Choose visible columns"/);
  assert.match(columns, /data-tooltip="Choose columns"/);
  assert.doesNotMatch(columns, /<Columns3 size=\{14\} \/> \{label\}/);
  for (const label of ["Connect terminal", "Disconnect terminal", "Reconnect terminal", "Clear terminal"]) {
    assert.match(terminal, new RegExp(`aria-label="${label}"`));
    assert.match(terminal, new RegExp(`data-tooltip="${label}"`));
  }
  assert.doesNotMatch(terminal, /className="terminal-command-preview"/);
  assert.doesNotMatch(terminal, /bash → sh → ash/);
});

test("bottom Terminal Workspace owns Pod and Node SSH sessions outside the resource drawer", () => {
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  const drawer = fs.readFileSync(path.join(rendererRoot, "components/PodDrawer.tsx"), "utf8");
  const chrome = fs.readFileSync(path.join(rendererRoot, "components/PodDrawerChrome.tsx"), "utf8");
  const panel = fs.readFileSync(path.join(rendererRoot, "components/BottomTerminalPanel.tsx"), "utf8");
  const ssh = fs.readFileSync(path.join(rendererRoot, "components/NodeSshTab.tsx"), "utf8");
  const drawerStyles = fs.readFileSync(path.join(rendererRoot, "styles/drawer.css"), "utf8");
  const styles = fs.readFileSync(path.join(rendererRoot, "styles/terminal.css"), "utf8");
  const uiState = fs.readFileSync(path.join(rendererRoot, "uiState.ts"), "utf8");
  const terminalsHook = fs.readFileSync(path.join(rendererRoot, "hooks/useBottomTerminals.ts"), "utf8");
  const model = loadTypeScript("components/BottomTerminalPanel.tsx", {
    "lucide-react": { ChevronDown: () => null, ChevronUp: () => null, X: () => null },
    "../uiState": { loadUiState: () => ({}), saveUiState: () => undefined },
    "./NodeSshTab": { NodeSshTab: () => null },
    "./TerminalTab": { TerminalTab: () => null },
  });
  assert.match(terminalsHook, /const \[bottomTerminals, setBottomTerminals\] = useState/);
  assert.match(app, /<BottomTerminalPanel/);
  assert.match(terminalsHook, /function openBottomNodeSsh/);
  assert.match(terminalsHook, /kind: "pod"/);
  assert.match(terminalsHook, /kind: "node-ssh"/);
  assert.match(terminalsHook, /bottomTerminals\.length >= 5/);
  assert.match(drawer, /onOpenTerminal\(pod, containers/);
  assert.match(drawer, /onOpenNodeSsh\(pod\)/);
  assert.doesNotMatch(drawer, /import \{ NodeSshTab \}/);
  assert.doesNotMatch(drawer, /<NodeSshTab/);
  assert.match(chrome, /aria-label=\{props\.resource === "pods" \? "Terminal" : "SSH"\}/);
  assert.doesNotMatch(chrome, /\| "terminal"/);
  assert.match(panel, /targets\.map/);
  assert.match(panel, /target\.kind === "pod"/);
  assert.match(panel, /<NodeSshTab/);
  assert.match(panel, /bottom-terminal-session/);
  assert.match(panel, /Collapse terminals/);
  assert.match(panel, /role="separator"/);
  assert.match(panel, /aria-orientation="horizontal"/);
  assert.match(panel, /onPointerCancel=\{stopResize\}/);
  assert.match(panel, /onLostPointerCapture=\{stopResize\}/);
  assert.match(app, /content-upper/);
  assert.match(styles, /\.content\.with-bottom-terminal\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s*auto;/s);
  assert.match(styles, /\.bottom-terminal-resize-handle\s*\{[^}]*cursor:\s*ns-resize;/s);
  assert.match(drawerStyles, /\.pod-terminal\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\);/s);
  assert.doesNotMatch(styles, /minmax\(280px,\s*42vh\)/);
  assert.match(styles, /\.bottom-terminal-session\s*\{[^}]*visibility:\s*hidden/s);
  assert.doesNotMatch(styles, /\.bottom-terminal-session\s*\{[^}]*display:\s*none/s);
  assert.match(uiState, /bottomTerminalHeight\?: number/);
  assert.match(ssh, /activeRef = useRef\(active\)/);
  assert.match(ssh, /sendTerminalResizeIfChanged/);
  assert.deepEqual(model.clampBottomTerminalHeight(400, 900), 400);
  assert.deepEqual(model.clampBottomTerminalHeight(100, 900), 180);
  assert.deepEqual(model.clampBottomTerminalHeight(900, 900), 740);
  assert.deepEqual(model.clampBottomTerminalHeight(220, 300), 140);
  assert.doesNotMatch(app, /PinnedTerminalPanel/);
  assert.doesNotMatch(drawer, /<TerminalTab/);
});

test("theme preferences normalize legacy values and resolve System safely", () => {
  const model = loadTypeScript("utils/theme.ts");
  const darkMedia = { matches: true };
  const lightMedia = { matches: false };
  assert.equal(model.normalizeThemePreference("dark"), "midnight");
  assert.equal(model.normalizeThemePreference("unknown-theme"), "midnight");
  assert.equal(model.resolveTheme("system", darkMedia), "midnight");
  assert.equal(model.resolveTheme("system", lightMedia), "light");
  assert.equal(model.resolveTheme("nord", lightMedia), "nord");
  assert.equal(model.resolveTheme("graphite", lightMedia), "graphite");
  assert.deepEqual(
    model.THEME_OPTIONS.map(({ id }) => id),
    ["system", "light", "midnight", "nord", "forest", "plum", "mocha", "graphite"],
  );
  const bootstrap = fs.readFileSync(path.join(rendererRoot, "public/theme-bootstrap.js"), "utf8");
  assert.match(bootstrap, /themes = new Set\(\[[^\]]*"graphite"/);
  for (const locale of ["en", "ru"]) {
    const messages = JSON.parse(fs.readFileSync(path.join(rendererRoot, `locales/${locale}.json`), "utf8"));
    assert.ok(messages["settings.theme.graphite"]);
    assert.ok(messages["settings.theme.graphite.description"]);
  }
});

test("theme application updates data attributes and persists the preference", () => {
  const previous = {
    document: global.document,
    localStorage: global.localStorage,
    window: global.window,
    CustomEvent: global.CustomEvent,
  };
  const stored = new Map();
  const events = [];
  global.document = { documentElement: { dataset: {} } };
  global.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  };
  global.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  global.window = {
    dispatchEvent: (event) => events.push(event),
    matchMedia: () => ({ matches: true }),
  };
  try {
    const model = loadTypeScript("utils/theme.ts");
    assert.equal(model.applyThemePreference("plum", { matches: false }), "plum");
    assert.deepEqual(global.document.documentElement.dataset, { themePreference: "plum", theme: "plum" });
    assert.equal(stored.get("kubedeck.theme"), "plum");
    stored.set("kubedeck.theme", "dark");
    assert.equal(model.restoreStoredThemePreference(), "midnight");
    assert.equal(global.document.documentElement.dataset.theme, "midnight");
    assert.equal(events.at(-1).detail, "midnight");
    stored.delete("kubedeck.theme");
    assert.equal(model.restoreStoredThemePreference(), "midnight");
    assert.equal(global.document.documentElement.dataset.themePreference, "system");
  } finally {
    global.document = previous.document;
    global.localStorage = previous.localStorage;
    global.window = previous.window;
    global.CustomEvent = previous.CustomEvent;
  }
});

test("every color theme exposes the shared token contract", () => {
  const tokens = fs.readFileSync(path.join(rendererRoot, "styles/tokens.css"), "utf8");
  const required = [
    "app-bg",
    "sidebar-bg",
    "topbar-bg",
    "panel",
    "panel-muted",
    "surface",
    "surface-2",
    "surface-hover",
    "surface-active",
    "surface-selected",
    "focus-ring",
    "text",
    "text-strong",
    "text-inverse",
    "muted",
    "border",
    "border-strong",
    "input-bg",
    "input-border",
    "button-bg",
    "button-border",
    "button-hover",
    "button-active",
    "button-disabled-bg",
    "button-disabled-text",
    "primary",
    "primary-soft",
    "metric-cpu",
    "metric-memory",
    "metric-storage",
    "code-bg",
    "terminal-bg",
    "terminal-text",
    "overlay",
    "shadow-menu",
    "shadow-lg",
    "success-bg",
    "pending-bg",
    "pending-border",
    "pending-text",
    "warning-bg",
    "danger-bg",
    "error-bg",
    "scrollbar-track",
    "scrollbar-thumb",
    "primary-resize",
  ];
  for (const token of required) assert.match(tokens, new RegExp(`--${token}:`), `missing --${token}`);
  for (const theme of ["midnight", "nord", "forest", "plum", "mocha", "graphite", "light"]) {
    assert.match(tokens, new RegExp(`data-theme=["']${theme}["']`), `missing ${theme} selector`);
  }

  const blocks = [...tokens.matchAll(/([^{}]+)\{([^{}]+)\}/g)];
  const base = cssHexTokens(blocks.filter(([, selector]) => selector.includes(":root,") || selector.includes('data-theme="midnight"')));
  for (const theme of ["midnight", "nord", "forest", "plum", "mocha", "graphite", "light"]) {
    const palette = {
      ...base,
      ...cssHexTokens(blocks.filter(([, selector]) => selector.includes(`data-theme="${theme}"`))),
    };
    for (const [foreground, background] of [
      ["text", "app-bg"],
      ["text", "panel"],
      ["muted", "panel"],
    ]) {
      assert.ok(contrastRatio(palette[foreground], palette[background]) >= 4.5, `${theme} ${foreground}/${background} must meet WCAG AA`);
    }
    if (theme === "graphite") {
      assert.ok(contrastRatio(palette["text-inverse"], palette.primary) >= 4.5, "graphite primary button must meet WCAG AA");
      assert.ok(contrastRatio(palette["text-inverse"], palette["primary-hover"]) >= 4.5, "graphite primary hover must meet WCAG AA");
    }
  }
});

test("2.8.1 Kubernetes statuses distinguish pending from failure", () => {
  const model = loadTypeScript("utils/kubernetesStatusTone.ts");
  assert.equal(model.kubernetesStatusTone({ phase: "Running", ready: "1/1" }), "success");
  assert.equal(model.kubernetesStatusTone({ phase: "Running", ready: "0/1" }), "pending");
  assert.equal(model.kubernetesStatusTone({ phase: "Pending", reason: "ContainerCreating" }), "pending");
  assert.equal(model.kubernetesStatusTone({ phase: "Pending", reason: "ImagePullBackOff" }), "pending");
  assert.equal(model.kubernetesStatusTone({ phase: "Running", reason: "CrashLoopBackOff" }), "danger");
  assert.equal(model.isKubernetesFailure("ImagePullBackOff"), true);
  assert.equal(model.kubernetesStatusTone({ phase: "Succeeded" }), "success");
  assert.equal(model.kubernetesStatusTone({ phase: "SomethingNew" }), "neutral");
  assert.equal(model.kubernetesStatusTone({ phase: "Running", deletionTimestamp: "2026-07-27T00:00:00Z" }), "pending");

  const table = fs.readFileSync(path.join(rendererRoot, "components/ResourceTable.tsx"), "utf8");
  const summary = fs.readFileSync(path.join(rendererRoot, "components/ResourceSummary.tsx"), "utf8");
  const tableStyles = fs.readFileSync(path.join(rendererRoot, "styles/resource-table.css"), "utf8");
  const layoutStyles = fs.readFileSync(path.join(rendererRoot, "styles/layout.css"), "utf8");
  assert.match(table, /kubernetesStatusTone\(row\)/);
  assert.match(summary, /kubernetesStatusTone\(row\)/);
  assert.doesNotMatch(table, /resource-row-warning|rowHealthClass/);
  assert.doesNotMatch(layoutStyles, /resource-row-warning/);
  assert.match(table, /not\\s\*ready[\s\S]*return "waiting"/);
  assert.match(tableStyles, /\.resource-table th,\s*\.resource-table td\s*\{[^}]*padding:\s*3px 10px;[^}]*line-height:\s*1\.1;/s);
  assert.match(tableStyles, /\.resource-table tbody tr\s*\{[^}]*min-height:\s*28px;/s);
  assert.match(tableStyles, /\.resource-table \.select-col input\[type="checkbox"\]\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;/s);
  assert.match(tableStyles, /\.table-footer\s*\{[^}]*border-top:\s*0;/s);
  assert.match(tableStyles, /\.phase-value\s*\{[^}]*font-weight:\s*650;/s);
  assert.match(tableStyles, /\.phase-value\.is-pending\s*\{[^}]*color:\s*var\(--pending-text\);/s);
  assert.doesNotMatch(tableStyles, /\.phase-value\.is-pending\s*\{[^}]*(?:background|border-color):/s);
});

function cssHexTokens(blocks) {
  const result = {};
  for (const [, , body] of blocks) {
    for (const match of body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)) result[match[1]] = match[2];
  }
  return result;
}

function contrastRatio(first, second) {
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const values = [luminance(first), luminance(second)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

test("resource pagination uses semantic button tokens for every state", () => {
  const component = fs.readFileSync(path.join(rendererRoot, "components/ResourceTablePagination.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(rendererRoot, "styles/resource-table.css"), "utf8");
  assert.equal((component.match(/className="secondary-btn"/g) || []).length, 4);
  for (const state of ["secondary-btn {", ":hover:not(:disabled)", ":active:not(:disabled)", ":disabled"]) {
    assert.match(styles, new RegExp(`\\.pagination-actions[\\s\\S]*?${state.replace(/[()]/g, "\\$&")}`));
  }
  for (const token of ["--button-bg", "--button-border", "--button-hover", "--button-active", "--button-disabled-bg"]) {
    assert.match(styles, new RegExp(`var\\(${token}\\)`));
  }
});

test("async action feedback enforces pending, success, error, and duplicate protection", async () => {
  const model = loadTypeScript("utils/asyncActionFeedback.ts");
  const clock = createTestScheduler();
  const phases = [];
  const controller = model.createAsyncActionFeedbackController({
    onPhaseChange: (phase) => phases.push(phase),
    scheduler: clock.scheduler,
  });

  const successful = controller.run(() => true);
  assert.equal(controller.phase(), "pending");
  assert.equal(await controller.run(() => true), false);
  await Promise.resolve();
  clock.advance(299);
  assert.equal(controller.phase(), "pending");
  clock.advance(1);
  assert.equal(await successful, true);
  assert.equal(controller.phase(), "success");
  clock.advance(model.ASYNC_ACTION_SUCCESS_MS);
  assert.equal(controller.phase(), "idle");

  const failed = controller.run(async () => {
    throw new Error("refresh failed");
  });
  await Promise.resolve();
  clock.advance(model.ASYNC_ACTION_MIN_PENDING_MS);
  assert.equal(await failed, false);
  assert.equal(controller.phase(), "error");
  clock.advance(model.ASYNC_ACTION_ERROR_MS);
  assert.equal(controller.phase(), "idle");
  assert.deepEqual(phases, ["pending", "success", "idle", "pending", "error", "idle"]);
});

test("async action feedback cleanup cancels timers and late phase changes", async () => {
  const model = loadTypeScript("utils/asyncActionFeedback.ts");
  const clock = createTestScheduler();
  const phases = [];
  const controller = model.createAsyncActionFeedbackController({
    onPhaseChange: (phase) => phases.push(phase),
    scheduler: clock.scheduler,
  });
  const completion = controller.run(() => true);
  await Promise.resolve();
  controller.dispose();
  clock.advance(5000);
  assert.equal(await completion, true);
  assert.deepEqual(phases, ["pending"]);
  assert.equal(clock.pending(), 0);
});

test("all manual refresh and reload surfaces use shared async feedback", () => {
  const required = [
    ["components/ProblemsPanel.tsx", /refreshActionLabels\(t\)/],
    ["components/AuditPanel.tsx", /refreshFeedback\.run\(\(\) => loadAudit\(\)\)/],
    ["components/PortForwardsPanel.tsx", /refreshFeedback\.run\(\(\) => refresh\(\)\)/],
    ["components/AboutPanel.tsx", /refreshFeedback\.run\(\(\) => load\(\)\)/],
    ["components/LogsTab.tsx", /useControlledAsyncActionFeedback\(loading, refreshFailed\)/],
    ["components/SecretTab.tsx", /refreshFeedback\.run\(\(\) => loadSecret\(\)\)/],
    ["components/YamlTab.tsx", /reloadFeedback\.run\(onReloadFromCluster\)/],
    ["components/ResourceCacheDiagnostics.tsx", /refreshFeedback\.run\(loadStatus\)/],
    ["components/WatchDiagnostics.tsx", /refreshFeedback\.run\(\(\) => loadStatus\(\)\)/],
  ];
  for (const [relativePath, pattern] of required) {
    const source = fs.readFileSync(path.join(rendererRoot, relativePath), "utf8");
    assert.match(source, pattern, `${relativePath} must use shared feedback`);
  }

  const resourceTable = fs.readFileSync(path.join(rendererRoot, "components/ResourceTable.tsx"), "utf8");
  assert.doesNotMatch(resourceTable, /<AsyncActionButton/);
  assert.doesNotMatch(resourceTable, />\s*Refresh\s*</);

  const styles = fs.readFileSync(path.join(rendererRoot, "styles/base.css"), "utf8");
  assert.match(styles, /@keyframes async-action-spin/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(styles, /var\(--success-border\)/);
  assert.match(styles, /var\(--danger-border\)/);
  assert.doesNotMatch(styles, /\.async-action[^}]*!important/s);

  const button = fs.readFileSync(path.join(rendererRoot, "components/AsyncActionButton.tsx"), "utf8");
  assert.match(button, /aria-busy=\{phase === "pending"\}/);
  assert.match(button, /aria-live="polite"/);

  const problems = fs.readFileSync(path.join(rendererRoot, "components/ProblemsPanel.tsx"), "utf8");
  const audit = fs.readFileSync(path.join(rendererRoot, "components/AuditPanel.tsx"), "utf8");
  const portForwards = fs.readFileSync(path.join(rendererRoot, "components/PortForwardsPanel.tsx"), "utf8");
  const watch = fs.readFileSync(path.join(rendererRoot, "components/WatchDiagnostics.tsx"), "utf8");
  assert.match(problems, /refreshProblems\(true\)/);
  assert.match(audit, /loadAudit\(true\)/);
  assert.match(portForwards, /refresh\(\{ quiet: true \}\)/);
  assert.match(watch, /loadStatus\(\{ quiet: true \}\)/);
});

function createTestScheduler() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  const scheduler = {
    now: () => now,
    setTimeout: (callback, delay) => {
      sequence += 1;
      timers.set(sequence, { callback, at: now + delay });
      return sequence;
    },
    clearTimeout: (timer) => timers.delete(timer),
  };
  return {
    scheduler,
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers.entries()].sort((left, right) => left[1].at - right[1].at)) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.callback();
      }
    },
    pending: () => timers.size,
  };
}

test("resource navigation resolves cluster and namespace scope", () => {
  const model = loadTypeScript("hooks/useResourceNavigation.ts", {
    "../navigation": {
      resourceTree: {},
      sectionForResource: (resource) => (resource === "nodes" ? "nodes" : "workloads"),
    },
    "../utils/kubeResources": {
      findResourceDefinition: (definitions, resource) => definitions.find((item) => item.resource === resource),
      sameResourceIdentity: () => false,
    },
  });
  const definitions = [
    { resource: "nodes", namespaced: false },
    { resource: "pods", namespaced: true },
  ];
  assert.deepEqual(model.resolveResourceNavigationTarget({ resource: "nodes", name: "n1", uid: "n1" }, "pods", "pods", "default", ["default"], definitions), {
    resource: "nodes",
    section: "nodes",
    namespace: "_cluster",
    clusterScoped: true,
  });
  assert.equal(model.resolveResourceNavigationTarget({ resource: "pods", namespace: "tools", name: "p1", uid: "p1" }, "pods", "pods", "_cluster", ["default"], definitions).namespace, "tools");

  const secret = { clusterId: "cluster-a", resource: "secrets", row: { uid: "secret-1", namespace: "tools", name: "token" } };
  const pod = { clusterId: "cluster-a", resource: "pods", row: { uid: "pod-1", namespace: "tools", name: "api" } };
  assert.equal(model.currentSelectedResourceTarget(secret, "cluster-a", "pods"), null);
  assert.equal(model.currentSelectedResourceTarget(secret, "cluster-b", "secrets"), null);
  assert.equal(model.currentSelectedResourceTarget(pod, "cluster-a", "pods"), pod);
});

test("namespace selections are isolated and reconciled per cluster", () => {
  const normalizeNamespaceSelection = (value) => {
    const raw = Array.isArray(value) ? value : value.split(",");
    const normalized = [...new Set(raw.map((item) => item.trim()).filter(Boolean))];
    if (normalized.includes("_cluster")) return ["_cluster"];
    if (normalized.includes("all") || normalized.length === 0) return ["all"];
    return normalized;
  };
  const model = loadTypeScript("hooks/useNamespaceRefresh.ts", {
    "../utils/kubeResources": {
      arraysEqual: (left, right) => left.length === right.length && left.every((item, index) => item === right[index]),
      normalizeNamespaceSelection,
    },
    "../utils/errors": { asErrorInfo: (error) => error, isAbortError: () => false },
    "../utils/refresh": { getAutoRefreshIntervalSeconds: () => 0 },
  });

  const stored = model.normalizeClusterNamespaceSelections({
    "cluster-a": ["team-a", "shared", "team-a"],
    "cluster-b": ["team-b"],
    scoped: ["_cluster"],
    broken: "default",
  });
  assert.deepEqual(stored, { "cluster-a": ["team-a", "shared"], "cluster-b": ["team-b"] });
  assert.deepEqual(model.rememberedNamespacesForCluster(stored, "cluster-a"), ["team-a", "shared"]);
  assert.deepEqual(model.rememberedNamespacesForCluster(stored, "cluster-b"), ["team-b"]);
  assert.deepEqual(model.rememberedNamespacesForCluster(stored, "cluster-c"), ["all"]);
  assert.deepEqual(model.reconcileClusterNamespaceSelection(["team-a", "removed"], ["default", "team-a"]), ["team-a"]);
  assert.deepEqual(model.reconcileClusterNamespaceSelection(["removed"], ["default", "team-a"]), ["all"]);
  assert.deepEqual(model.reconcileClusterNamespaceSelection(["team-a"], []), ["team-a"]);
  assert.deepEqual(model.reconcileClusterNamespaceSelection(["_cluster"], ["default"]), ["all"]);
});

test("a usage header sorts on a chosen metric instead of its formatted cell", () => {
  const metrics = loadTypeScript("utils/resourceTableSortMetrics.ts");
  const table = fs.readFileSync(path.join(rendererRoot, "components/ResourceTable.tsx"), "utf8");
  const menu = fs.readFileSync(path.join(rendererRoot, "components/ResourceTableSortMenu.tsx"), "utf8");

  // Every usage column offers the values its bars show, and nothing else does.
  assert.deepEqual(
    metrics.columnSortMetrics("nodeResources").map((metric) => metric.key),
    ["cpuUsagePercentValue", "memoryUsagePercentValue", "diskUsagePercent"],
  );
  assert.deepEqual(
    metrics.columnSortMetrics("podResources").map((metric) => metric.key),
    ["podCpuUsageValue", "podMemoryUsageValue"],
  );
  assert.deepEqual(
    metrics.columnSortMetrics("namespaceResources").map((metric) => metric.key),
    ["namespaceCpuUsedValue", "namespaceMemoryUsedValue", "namespaceStorageUsedValue"],
  );
  assert.deepEqual(metrics.columnSortMetrics("name"), []);

  // The active sort keeps the owning column marked even though the sort key is
  // not a column of its own.
  assert.equal(metrics.sortKeyBelongsToColumn("podResources", "podCpuUsageValue"), true);
  assert.equal(metrics.sortKeyBelongsToColumn("podResources", "podMemoryUsageValue"), true);
  assert.equal(metrics.sortKeyBelongsToColumn("podResources", "cpuUsagePercentValue"), false);
  assert.equal(metrics.sortKeyBelongsToColumn("name", "name"), true);
  assert.equal(metrics.activeSortMetric("nodeResources", "diskUsagePercent").label, "Disk %");
  assert.equal(metrics.activeSortMetric("nodeResources", "name"), null);

  // The header renders the menu instead of a plain sort button, and reuses
  // changeSort so picking the active value flips the direction.
  assert.match(table, /columnSortMetrics\(column\.key\)\.length \? \(/);
  assert.match(table, /<ResourceTableSortMenu/);
  assert.match(menu, /onSelect\(metric\.key\)/);

  // A hidden or reordered column must not reset a metric sort.
  const state = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceTableState.ts"), "utf8");
  assert.match(state, /!visibleColumns\.some\(\(column\) => sortKeyBelongsToColumn\(column\.key, sortKey\)\)/);

  // The direction is an arrow, not an ASC/DESC badge, and the header cell
  // carries it for anyone who cannot see the arrow.
  const arrow = fs.readFileSync(path.join(rendererRoot, "components/SortDirectionArrow.tsx"), "utf8");
  assert.match(arrow, /ArrowUp/);
  assert.match(arrow, /ArrowDown/);
  assert.match(table, /aria-sort=\{sortKeyBelongsToColumn\(column\.key, sortKey\)/);
  for (const source of [table, menu]) assert.doesNotMatch(source, /"ASC" : "DESC"/);

  // Header cells clip their content and are sticky at the same depth, so an
  // open menu is invisible without both of these — it renders and is clicked,
  // but nothing is shown.
  const styles = fs.readFileSync(path.join(rendererRoot, "styles/resource-table.css"), "utf8");
  const openHeader = styles.match(/\.resource-table th:has\(\.table-sort-menu \[aria-expanded="true"\]\)\s*\{[^}]*\}/);
  assert.ok(openHeader, "the open sort menu needs a rule on its header cell");
  assert.match(openHeader[0], /overflow: visible;/);
  assert.match(openHeader[0], /z-index: [1-9]/);
});

test("rows without a usage metric sort to the low end instead of scattering", () => {
  const model = loadTypeScript("hooks/useResourceTableState.ts", {
    "../utils/resourceTableSortMetrics": { sortKeyBelongsToColumn: () => true },
    "../utils/time": { parseTimestamp: () => 0 },
    "../uiState": { loadUiState: () => ({}), saveUiState: () => undefined },
  });
  const rows = [
    { uid: "a", name: "a", podCpuUsageValue: 25 },
    { uid: "b", name: "b" },
    { uid: "c", name: "c", podCpuUsageValue: 300 },
    { uid: "d", name: "d", podCpuUsageValue: 4 },
  ];

  const ascending = [...rows].sort((left, right) => model.compareRows(left, right, "podCpuUsageValue"));
  assert.deepEqual(
    ascending.map((row) => row.name),
    ["b", "d", "a", "c"],
  );

  // Descending is the interesting direction — the busiest first, the rows with
  // no reading last rather than at the top.
  const descending = [...rows].sort((left, right) => model.compareRows(left, right, "podCpuUsageValue") * -1);
  assert.deepEqual(
    descending.map((row) => row.name),
    ["c", "a", "d", "b"],
  );

  // Text columns still compare as text.
  assert.ok(model.compareRows({ name: "a" }, { name: "b" }, "name") < 0);
});

test("pod usage falls back from limit to request to the raw reading", () => {
  const table = fs.readFileSync(path.join(rendererRoot, "components/ResourceTable.tsx"), "utf8");
  const bar = fs.readFileSync(path.join(rendererRoot, "components/ResourceUsageBar.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(rendererRoot, "styles/resource-table.css"), "utf8");

  // The three tiers, in order.
  const cell = table.slice(table.indexOf("function PodUsageBar"), table.indexOf("function unclampedPercent"));
  assert.ok(cell.indexOf('denominatorLabel="limit"') < cell.indexOf('denominatorLabel="request"'), "a limit must win over a request");
  assert.match(cell, /unavailableLabel=\{usedText \|\| "N\/A"\}/);
  assert.doesNotMatch(cell, /"No limit"/);

  // A request ratio may exceed 100%: the track clamps, the reading does not.
  assert.match(bar, /width: `\$\{Math\.min\(100, percent\)\}%`/);
  assert.match(bar, /<small>\{percent === null \? unavailableLabel : `\$\{percent\}%`\}<\/small>/);
  assert.match(bar, /const over = percent !== null && percent > 100;/);
  assert.match(styles, /\.resource-usage-bar\.is-soft\.is-over/);
});

test("a namespace refresh cannot erase the selection a cluster-scoped resource hides", () => {
  const refresh = fs.readFileSync(path.join(rendererRoot, "hooks/useNamespaceRefresh.ts"), "utf8");
  const navigation = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceNavigation.ts"), "utf8");

  // The poll returns before it can remember anything for a cluster that is no
  // longer active or while `_cluster` is the visible scope.
  assert.match(refresh, /if \(clusterId !== activeClusterId\) return;/);
  assert.match(refresh, /if \(current\.includes\("_cluster"\)\) return;\s*/);
  const pollBody = refresh.slice(refresh.indexOf("const loadNamespaces"), refresh.indexOf("const setNamespaceSelection"));
  assert.ok(
    pollBody.indexOf('if (current.includes("_cluster")) return;') < pollBody.indexOf("rememberClusterSelection(clusterId, reconciled)"),
    "the cluster-scoped guard must run before the poll writes the remembered selection",
  );

  // Restoring falls back to the scope on screen, never to all namespaces.
  assert.match(refresh, /const restored = stored\.length \? stored : current\.length \? current : \["all"\];/);
  assert.doesNotMatch(refresh, /const remembered = rememberedNamespacesForCluster\(selectionsRef\.current, clusterId\);\s*setSelectedNamespaces\(remembered\);/s);

  // Opening a resource from Search, Events or Related keeps a scope that already
  // covers the target instead of narrowing it to one namespace.
  assert.match(navigation, /const needsNarrowerScope = /);
  assert.match(navigation, /!activeSelection\.includes\("all"\) && !activeSelection\.includes\(target\.namespace\)/);
  assert.match(navigation, /if \(target\.clusterScoped \|\| lookupCoversSelection\) setRows\(/);
});

test("App keeps drawer selection atomic and persists namespace scope by cluster", () => {
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  const persistence = fs.readFileSync(path.join(rendererRoot, "hooks/usePersistUiState.ts"), "utf8");
  assert.match(app, /useState<SelectedResourceTarget \| null>/);
  assert.match(app, /setSelectedTarget\(\{ clusterId: activeCluster\.id, resource, row: selectedRow \}\)/);
  assert.match(app, /cancelResourceNavigation\(\);\s*setSelectedTarget\(\{ clusterId: activeCluster\.id, resource, row: selectedRow \}\)/s);
  assert.doesNotMatch(app, /useState<ResourceRow \| null>\(null\)/);
  assert.doesNotMatch(app, /const \[selectedResource, setSelectedResource\]/);
  assert.match(persistence, /namespaceSelectionVersion: 2/);
  assert.match(persistence, /selectedNamespacesByClusterId/);
  assert.match(persistence, /delete next\.selectedNamespaces/);
  const navigation = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceNavigation.ts"), "utf8");
  assert.match(navigation, /navigationRequestRef\.current !== requestId/);
  assert.match(navigation, /navigationAbortRef\.current\?\.abort\(\)/);
});

test("bulk action helpers preserve identity, scope summary, and terminating state", () => {
  const model = loadTypeScript("hooks/useBulkResourceActions.ts");
  const rows = [
    { uid: "a", name: "pod-a", namespace: "default" },
    { uid: "b", name: "pod-b", namespace: "tools" },
  ];
  assert.equal(model.resourceIdentityLabel(rows[0]), "default/pod-a");
  assert.equal(model.bulkDeleteNamespaceSummary(rows), "default, tools");
  assert.match(model.bulkDeleteListText("pods", rows), /pods default\/pod-a/);
  const deleting = model.markDeletingRow("pods", rows[0]);
  assert.equal(deleting.status, "Terminating");
  assert.equal(deleting.phase, "Terminating");
  assert.ok(deleting.deletionTimestamp);

  const deletedSelection = model.selectedRowAfterBulkDelete("pods", "pods", rows[0], [rows[0]], []);
  assert.equal(deletedSelection, null);
  const failedSelection = model.selectedRowAfterBulkDelete("pods", "pods", deleting, [], [{ row: rows[0], message: "forbidden" }]);
  assert.equal(failedSelection, rows[0]);
  assert.equal(model.selectedRowAfterBulkDelete("pods", "deployments", rows[0], [rows[0]], []), rows[0]);
});

test("bulk delete and successful node actions stay silent", () => {
  const actions = fs.readFileSync(path.join(rendererRoot, "hooks/useBulkResourceActions.ts"), "utf8");
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  const modal = fs.readFileSync(path.join(rendererRoot, "components/BulkActionModals.tsx"), "utf8");
  const drawerStyles = fs.readFileSync(path.join(rendererRoot, "styles/drawer.css"), "utf8");
  const layoutStyles = fs.readFileSync(path.join(rendererRoot, "styles/layout.css"), "utf8");
  const locales = ["locales/en.json", "locales/ru.json"].map((relativePath) => fs.readFileSync(path.join(rendererRoot, relativePath), "utf8"));
  const bulkFlow = actions.slice(actions.indexOf("const confirmBulkDelete"), actions.indexOf("const requestNodeAction"));

  assert.doesNotMatch(bulkFlow, /setNodeActionMessage/);
  assert.doesNotMatch(bulkFlow, /bulkDelete\.(?:requested|completed)/);
  assert.doesNotMatch(bulkFlow, /if \(deletedRows\.length\)/);
  assert.match(bulkFlow, /await reloadResources\(target\.clusterId, target\.resource, selectedNamespaces\)/);
  assert.match(bulkFlow, /setError\(error\)/);
  assert.doesNotMatch(actions, /nodeActionMessage/);
  assert.doesNotMatch(app, /bulkActions\.nodeActionMessage/);
  assert.doesNotMatch(app, /bulkActions\.(?:message|clearMessage)/);
  assert.match(modal, /bulk-delete-modal/);
  assert.match(modal, /onCopyBulkDelete/);
  assert.doesNotMatch(drawerStyles, /bulk-delete-result/);
  assert.doesNotMatch(layoutStyles, /bulk-delete-result/);
  for (const locale of locales) {
    assert.doesNotMatch(locale, /bulkDelete\.(?:requested|completed|completedAt|resultTitle|copyResult|failureDetails|failedMessage|total)/);
  }
});

test("bulk confirmations remain bound to their source cluster", () => {
  const actions = fs.readFileSync(path.join(rendererRoot, "hooks/useBulkResourceActions.ts"), "utf8");
  assert.match(actions, /interface BulkDeleteTarget \{\s*clusterId: string;/);
  assert.match(actions, /interface NodeActionConfirmation \{\s*clusterId: string;/);
  assert.match(actions, /setBulkDelete\(\{ clusterId: activeCluster\.id, resource, rows \}\)/);
  assert.match(actions, /api\.resourceAction\(target\.clusterId, target\.resource/);
  assert.match(actions, /api\.resourceAction\(target\.clusterId, "nodes"/);
  assert.match(actions, /reloadResources\(target\.clusterId, "nodes"/);
  assert.match(actions, /nodePreviewRequestRef\.current !== requestId/);
  assert.match(actions, /}, \[activeCluster\?\.id\]\)/);
});

test("bulk partial failures preserve counts and command preview without leaking Secret data", () => {
  const model = loadTypeScript("hooks/useBulkResourceActions.ts");
  const error = model.buildPartialActionError({
    label: "Drain",
    resource: "nodes",
    completedCount: 1,
    failures: [
      { row: { uid: "b", name: "node-b" }, message: "Secret token=super-sensitive-value" },
      { row: { uid: "c", name: "node-c" }, message: "connection timed out" },
    ],
    commandPreview: "kubectl drain node-a\nkubectl drain node-b\nkubectl drain node-c",
  });
  assert.equal(error.code, "PARTIAL_RESULT");
  assert.equal(error.message, "Drain partial result. Completed: 1. Failed: 2.");
  assert.match(error.rawStderr, /nodes _cluster\/node-b - Sensitive error details were redacted/);
  assert.match(error.rawStderr, /nodes _cluster\/node-c - connection timed out/);
  assert.doesNotMatch(error.rawStderr, /super-sensitive-value/);
  assert.match(error.commandPreview, /kubectl drain node-b/);
});

test("resource table normalization keeps known columns and one visible column", () => {
  const model = loadTypeScript("hooks/useResourceTableState.ts", {
    "../utils/time": { parseTimestamp: (value) => Date.parse(String(value)) },
  });
  const columns = [
    { key: "name", label: "Name" },
    { key: "status", label: "Status" },
    { key: "age", label: "Age" },
  ];
  assert.deepEqual(model.normalizeColumnOrder(["status", "missing"], columns), ["status", "name", "age"]);
  assert.deepEqual(model.normalizeHiddenColumns(["name", "status", "age", "missing"], columns), ["name", "status"]);
  assert.deepEqual(model.moveColumnKey(["name", "status", "age"], "age", "name"), ["age", "name", "status"]);
  assert.deepEqual(model.resourceTablePreferencePatch("pods", columns, { name: 240 }, ["status", "name"], ["age"]), {
    columnWidths: { pods: { name: 240 } },
    columnOrders: { pods: ["status", "name", "age"] },
    hiddenColumns: { pods: ["age"] },
  });
});

test("drawer request generations reject stale responses and reset resource data", () => {
  const model = loadTypeScript("hooks/usePodDrawerResourceLifecycle.ts", {
    "../api": { ApiError: class ApiError extends Error {} },
    "../components/podDrawerHelpers": { isAbortError: () => false },
  });
  const guard = model.createDrawerRequestGuard();
  const yamlRequest = guard.next();
  const describeRequest = guard.next();
  assert.equal(guard.isCurrent(yamlRequest), false);
  assert.equal(guard.isCurrent(describeRequest), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(describeRequest), false);
  assert.deepEqual(model.drawerResourceResetSnapshot(), {
    content: "",
    describeContent: "",
    yamlBaseline: "",
    yamlDraft: "",
    yamlObjectKey: "",
    events: [],
    relatedLinks: [],
    relatedSources: {},
    relatedErrors: [],
    metrics: {},
    serviceEndpoints: null,
    usageHistory: null,
  });

  const firstRow = { uid: "pod-uid", name: "pod-a", namespace: "tools", status: "Running" };
  const refreshedRow = { ...firstRow, status: "Pending", restarts: 2 };
  const identity = model.drawerResourceIdentity("cluster-a", "pods", firstRow);
  assert.equal(model.drawerResourceIdentity("cluster-a", "pods", refreshedRow), identity);
  assert.notEqual(model.drawerResourceIdentity("cluster-b", "pods", refreshedRow), identity);
  assert.notEqual(model.drawerResourceIdentity("cluster-a", "deployments", refreshedRow), identity);
  assert.notEqual(model.drawerResourceIdentity("cluster-a", "pods", { ...refreshedRow, uid: "replacement-uid" }), identity);
  assert.notEqual(model.drawerResourceIdentity("cluster-a", "pods", { ...refreshedRow, name: "pod-b" }), identity);
  assert.notEqual(model.drawerResourceIdentity("cluster-a", "pods", { ...refreshedRow, namespace: "default" }), identity);
  assert.equal(model.drawerResourceIdentity("cluster-a", "pods", null), "");
});

test("drawer auto-refresh keeps stable lifecycle and YAML uses compact results", () => {
  const lifecycle = fs.readFileSync(path.join(rendererRoot, "hooks/usePodDrawerResourceLifecycle.ts"), "utf8");
  const drawer = fs.readFileSync(path.join(rendererRoot, "components/PodDrawer.tsx"), "utf8");
  const yamlActions = fs.readFileSync(path.join(rendererRoot, "hooks/usePodDrawerYamlActions.ts"), "utf8");
  const yaml = fs.readFileSync(path.join(rendererRoot, "components/YamlTab.tsx"), "utf8");
  const drawerStyles = fs.readFileSync(path.join(rendererRoot, "styles/drawer.css"), "utf8");
  const lightStyles = fs.readFileSync(path.join(rendererRoot, "styles/related-panel-polish.css"), "utf8");

  assert.match(lifecycle, /}, \[currentObjectKey\]\);/);
  assert.doesNotMatch(lifecycle, /}, \[api, clusterId, pod,/);
  assert.match(lifecycle, /tab === "yaml" && yamlObjectKey === currentObjectKey/);
  assert.match(lifecycle, /snapshotObjectKey === currentObjectKey/);
  assert.match(lifecycle, /content: snapshotIsCurrent \? content : ""/);
  assert.match(drawer, /drawerResourceIdentity\(clusterId, resource, pod\)/);
  assert.doesNotMatch(drawer, /<div key=\{currentObjectKey\} className=/);
  assert.match(drawer, /const resolvedInitialTab: DrawerTab = drawerTabs\.includes\(initialTab\) \? initialTab : "summary";/);
  assert.match(yamlActions, /setYamlStatus\(t\("yaml\.dryRunPassed"\)\)/);
  assert.match(yamlActions, /setYamlStatus\(t\("yaml\.applied"\)\)/);
  assert.match(yaml, /className="apply-result" role="status" aria-live="polite"/);
  for (const source of [drawer, yaml, drawerStyles, lightStyles]) {
    assert.doesNotMatch(source, /yaml-operation-output/);
  }
  assert.doesNotMatch(yaml, /Copy output/);
  assert.match(drawer, /<ErrorPanel error=\{error\}/);
});

test("watch reconnect controller keeps one pending reconnect and stops cleanly", () => {
  const model = loadTypeScript("hooks/useResourceWatch.ts");
  const scheduled = [];
  const cancelled = [];
  const controller = model.createWatchReconnectController(
    (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    (timer) => cancelled.push(timer),
    25,
  );
  const first = controller.connectionStarted();
  controller.connectionClosed(first, () => undefined);
  controller.connectionClosed(first, () => undefined);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 25);
  const second = controller.connectionStarted();
  controller.connectionClosed(first, () => undefined);
  assert.equal(scheduled.length, 1);
  controller.stop();
  assert.deepEqual(cancelled, [1]);
  controller.connectionClosed(second, () => undefined);
  assert.equal(scheduled.length, 1);
});

test("watch events are coalesced with a floor and a ceiling, so a busy cluster neither storms nor freezes", () => {
  const model = loadTypeScript("hooks/useResourceWatch.ts");
  const single = createTestScheduler();
  const quietRuns = [];
  const quiet = model.createWatchRefreshCoalescer(() => quietRuns.push(single.scheduler.now()), single.scheduler.setTimeout, single.scheduler.clearTimeout, single.scheduler.now);

  // A lone event still settles for the debounce and nothing longer.
  quiet.requestRefresh();
  single.advance(model.WATCH_REFRESH_DEBOUNCE_MS - 1);
  assert.deepEqual(quietRuns, []);
  single.advance(1);
  assert.equal(quietRuns.length, 1);

  // An event every 100ms used to reset the settle timer forever: the refresh
  // never ran, and the polling fallback stays off while the socket is healthy.
  const busy = createTestScheduler();
  const busyRuns = [];
  const coalescer = model.createWatchRefreshCoalescer(() => busyRuns.push(busy.scheduler.now()), busy.scheduler.setTimeout, busy.scheduler.clearTimeout, busy.scheduler.now);
  const step = 100;
  for (let tick = 0; tick < 80; tick += 1) {
    coalescer.requestRefresh();
    busy.advance(step);
  }
  assert.ok(busyRuns.length >= 2, `a stream of events must still refresh the table, got ${busyRuns.length} refreshes`);

  for (let index = 1; index < busyRuns.length; index += 1) {
    const gap = busyRuns[index] - busyRuns[index - 1];
    // The floor: a full list load per event burst, not per event.
    assert.ok(gap >= model.WATCH_REFRESH_MIN_INTERVAL_MS, `refreshes ${gap}ms apart are closer than the minimum interval`);
    // The ceiling: the table is never left behind for longer than this.
    assert.ok(gap <= model.WATCH_REFRESH_MAX_WAIT_MS + step, `refreshes ${gap}ms apart leave the table stale past the maximum wait`);
  }

  // Stopping cancels the pending load rather than firing it after teardown.
  coalescer.requestRefresh();
  coalescer.stop();
  const stoppedAt = busyRuns.length;
  busy.advance(model.WATCH_REFRESH_MAX_WAIT_MS * 2);
  assert.equal(busyRuns.length, stoppedAt);
  assert.equal(busy.pending(), 0);
});

test("resource watch lifecycle does not stop a shared backend watch", () => {
  const source = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceWatch.ts"), "utf8");
  assert.match(source, /\.startWatch\(clusterId, resource, watchNamespace\)/);
  assert.doesNotMatch(source, /\.stopWatch\(/);
  assert.doesNotMatch(source, /autoStartedWatchId/);
});

function normalizeNamespaceSelectionForTest(value) {
  const raw = Array.isArray(value) ? value : value.split(",");
  const normalized = [...new Set(raw.map((item) => item.trim()).filter(Boolean))];
  if (normalized.includes("_cluster")) return ["_cluster"];
  if (normalized.includes("all") || normalized.length === 0) return ["all"];
  return normalized;
}

function createResourceLoaderHarness() {
  const batches = [];
  const state = { rows: {}, loading: false, error: null, clearedPendingActions: 0 };
  const setRows = (next) => {
    state.rows = typeof next === "function" ? next(state.rows) : next;
  };
  const model = loadTypeScript("hooks/useResourceLoader.ts", {
    "../utils/errors": {
      asErrorInfo: (error) => ({ code: "FAILED", message: String(error?.message ?? error), rawStderr: "", commandPreview: "" }),
      isAbortError: (error) => error?.name === "AbortError",
    },
    "../utils/kubeResources": {
      normalizeNamespaceSelection: normalizeNamespaceSelectionForTest,
      resourceScopeKey: (clusterId, resource, namespaces) => `${clusterId} ${resource} ${normalizeNamespaceSelectionForTest(namespaces).join(",")}`,
      loadNamespaceResourceBatches: (api, clusterId, resource, namespaces, signal) =>
        new Promise((resolve, reject) => {
          batches.push({ clusterId, resource, namespaces: [...namespaces], signal, resolve, reject });
        }),
    },
  });
  // The hook runs against the stubbed React of this harness, so it is called
  // through a plain alias and not as a React hook.
  const buildLoader = model.useResourceLoader;
  const load = buildLoader({
    api: {},
    activeCluster: { id: "cluster-a" },
    resource: "pods",
    namespaces: ["all"],
    setRows,
    setNamespaces: () => undefined,
    setActiveCluster: () => undefined,
    setUnavailableCluster: () => undefined,
    setSelectedRow: () => undefined,
    clearPendingActions: () => {
      state.clearedPendingActions += 1;
    },
    setLoading: (value) => {
      state.loading = value;
    },
    setError: (value) => {
      state.error = value;
    },
  });
  return { load, batches, state };
}

test("resource scope key identifies cluster, resource and namespace selection", () => {
  const model = loadTypeScript("utils/kubeResources.ts");
  const scope = (clusterId, resource, namespaces) => [clusterId, resource, namespaces].join("\u0000");
  assert.equal(model.resourceScopeKey("cluster-a", "pods", ["all"]), scope("cluster-a", "pods", "all"));
  assert.equal(model.resourceScopeKey("cluster-a", "pods", "kube-system"), scope("cluster-a", "pods", "kube-system"));
  assert.equal(model.resourceScopeKey("cluster-a", "pods", ["kube-system", "all"]), scope("cluster-a", "pods", "all"));
  assert.equal(model.resourceScopeKey("cluster-a", "pods", [" tools ", "tools", "apps"]), scope("cluster-a", "pods", "tools,apps"));
  assert.equal(model.resourceScopeKey("cluster-a", "nodes", ["_cluster"]), scope("cluster-a", "nodes", "_cluster"));
  assert.notEqual(model.resourceScopeKey("cluster-a", "pods", ["kube-system"]), model.resourceScopeKey("cluster-b", "pods", ["kube-system"]));
});

test("a namespace switch drops the rows of the previous scope before awaiting", async () => {
  const previousWindow = global.window;
  global.window = { setTimeout: () => 0, clearTimeout: () => undefined };
  try {
    const { load, batches, state } = createResourceLoaderHarness();

    const scoped = load("cluster-a", "pods", ["kube-system"]);
    batches[0].resolve([{ items: [{ uid: "pod-kube-system" }] }]);
    assert.equal(await scoped, true);
    assert.deepEqual(state.rows.pods, [{ uid: "pod-kube-system" }]);

    const clearedBefore = state.clearedPendingActions;
    const widened = load("cluster-a", "pods", ["all"]);
    // The table must not keep another namespace on screen while the wide load runs.
    assert.deepEqual(state.rows.pods, []);
    assert.equal(state.clearedPendingActions, clearedBefore + 1, "pending bulk actions of the previous scope must be dropped");
    assert.equal(batches[1].namespaces.length, 1);
    assert.equal(batches[1].namespaces[0], "all");

    batches[1].resolve([{ items: [{ uid: "pod-a" }, { uid: "pod-b" }] }]);
    assert.equal(await widened, true);
    assert.deepEqual(state.rows.pods, [{ uid: "pod-a" }, { uid: "pod-b" }]);
  } finally {
    global.window = previousWindow;
  }
});

test("a silent watch refresh never aborts a running load of the same scope", async () => {
  const previousWindow = global.window;
  global.window = { setTimeout: () => 0, clearTimeout: () => undefined };
  try {
    const { load, batches, state } = createResourceLoaderHarness();

    const widened = load("cluster-a", "pods", ["all"]);
    assert.equal(batches.length, 1);

    assert.equal(await load("cluster-a", "pods", ["all"], true), false);
    assert.equal(await load("cluster-a", "pods", ["all"], true), false);
    assert.equal(batches.length, 1, "silent refreshes must be coalesced instead of restarting the load");
    assert.equal(batches[0].signal.aborted, false, "the running load must survive watch events");

    batches[0].resolve([{ items: [{ uid: "pod-a" }] }]);
    assert.equal(await widened, true);
    assert.deepEqual(state.rows.pods, [{ uid: "pod-a" }]);

    // Coalesced watch events still produce exactly one trailing refresh.
    assert.equal(batches.length, 2);
    assert.deepEqual(batches[1].namespaces, ["all"]);
    batches[1].resolve([{ items: [{ uid: "pod-a" }, { uid: "pod-b" }] }]);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(state.rows.pods, [{ uid: "pod-a" }, { uid: "pod-b" }]);
    assert.equal(batches.length, 2);
  } finally {
    global.window = previousWindow;
  }
});

test("manual refresh and scope changes still supersede a running load", async () => {
  const previousWindow = global.window;
  global.window = { setTimeout: () => 0, clearTimeout: () => undefined };
  try {
    const { load, batches, state } = createResourceLoaderHarness();

    const stale = load("cluster-a", "pods", ["all"]);
    const manual = load("cluster-a", "pods", ["all"]);
    assert.equal(batches.length, 2);
    assert.equal(batches[0].signal.aborted, true);

    batches[1].resolve([{ items: [{ uid: "pod-a" }] }]);
    assert.equal(await manual, true);
    batches[0].resolve([{ items: [{ uid: "stale" }] }]);
    assert.equal(await stale, false);
    assert.deepEqual(state.rows.pods, [{ uid: "pod-a" }], "a superseded response must never reach the table");

    const switched = load("cluster-a", "pods", ["kube-system"]);
    assert.equal(batches[1].signal.aborted, false);
    assert.equal(batches[2].namespaces[0], "kube-system");
    assert.deepEqual(state.rows.pods, []);
    batches[2].resolve([{ items: [{ uid: "pod-kube-system" }] }]);
    assert.equal(await switched, true);
  } finally {
    global.window = previousWindow;
  }
});

test("resource polling is only a fallback while live watch is unavailable", () => {
  const refresh = loadTypeScript("utils/refresh.ts");
  assert.equal(refresh.shouldPollResources(10, false), true);
  assert.equal(refresh.shouldPollResources(10, true), false);
  assert.equal(refresh.shouldPollResources(0, false), false);

  const watch = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceWatch.ts"), "utf8");
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  assert.match(watch, /backendReady && socketReady/);
  assert.match(watch, /nextSocket\.onopen/);
  assert.match(watch, /return watchHealthy/);
  assert.match(app, /const watchHealthy = useResourceWatch\(/);
  assert.match(app, /shouldPollResources\(intervalSeconds, watchHealthy\)/);
});

test("resource table keeps one sticky header inside its scroll container", () => {
  const table = fs.readFileSync(path.join(rendererRoot, "components/ResourceTable.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(rendererRoot, "styles/resource-table.css"), "utf8");
  assert.equal((table.match(/<table\b/g) ?? []).length, 1);
  assert.equal((table.match(/<colgroup>/g) ?? []).length, 1);
  assert.match(table, /<div className="table-scroll">[\s\S]*<thead>/);
  assert.match(styles, /\.resource-table th\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*z-index:\s*\d+;[^}]*background:\s*var\(--table-head\);/s);
});

test("resource table offers a 2000 row page without changing its default", () => {
  const state = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceTableState.ts"), "utf8");
  assert.match(state, /PAGE_SIZE_OPTIONS\s*=\s*\[50, 100, 200, 500, 1000, 2000\]/);
  assert.match(state, /DEFAULT_PAGE_SIZE\s*=\s*200/);
  assert.match(state, /visibleRows\.slice\(pageStart, pageStart \+ pageSize\)/);
});

test("resource table selection pruning and derived row lists avoid O(n^2) and re-render churn", () => {
  const state = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceTableState.ts"), "utf8");
  assert.doesNotMatch(state, /\.filter\(\(key\) => new Set\(rows\.map\(rowKey\)\)\.has\(key\)\)/, "rows.map(rowKey) must not be rebuilt inside the per-key filter callback");
  assert.match(state, /const rowKeys = new Set\(rows\.map\(rowKey\)\);/);
  assert.match(state, /setSelected\(\(current\) => new Set\(Array\.from\(current\)\.filter\(\(key\) => rowKeys\.has\(key\)\)\)\);/);
  assert.match(state, /const renderedRows = useMemo\(\(\) => visibleRows\.slice\(pageStart, pageStart \+ pageSize\), \[visibleRows, pageStart, pageSize\]\);/);
  assert.match(state, /const selectedRows = useMemo\(\(\) => visibleRows\.filter\(\(row\) => selected\.has\(rowKey\(row\)\)\), \[visibleRows, selected\]\);/);
  assert.match(state, /const selectedPageRows = useMemo\(\(\) => renderedRows\.filter\(\(row\) => selected\.has\(rowKey\(row\)\)\), \[renderedRows, selected\]\);/);
});

test("resource table columns, YAML match count, manifest diff and log filtering are memoized", () => {
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  assert.match(app, /const tableColumns = useMemo\(\(\) => buildResourceTableColumns\(t\), \[t\]\);/);

  const yamlTab = fs.readFileSync(path.join(rendererRoot, "components/YamlTab.tsx"), "utf8");
  assert.match(yamlTab, /const matchCount = useMemo\(\(\) => \(yamlQuery \? countMatches\(yamlDraft, yamlQuery\) : 0\), \[yamlDraft, yamlQuery\]\);/);
  assert.doesNotMatch(yamlTab, /index = text\.toLowerCase\(\)\.indexOf\(query\.toLowerCase\(\), index \+ query\.length\)/, "countMatches must not lower-case text/query inside its scan loop");

  const manifestCompare = fs.readFileSync(path.join(rendererRoot, "components/ManifestCompare.tsx"), "utf8");
  assert.match(manifestCompare, /const \{ left, right, rows, renderError \} = useMemo\(\(\) => \{/);
  assert.match(manifestCompare, /\}, \[currentYaml, targetYaml, raw, error\]\);/);

  const logsTab = fs.readFileSync(path.join(rendererRoot, "components/LogsTab.tsx"), "utf8");
  assert.match(logsTab, /const \{ lines, visibleLines, visibleText \} = useMemo\(\(\) => \{/);
  assert.match(logsTab, /\}, \[content, normalizedQuery\]\);/);
});

test("workspace resource tabs add, deduplicate, limit, and close deterministically", () => {
  const model = loadTypeScript("utils/workspaceTabs.ts");
  const make = (name) => ({ id: name, clusterId: "c", clusterName: "C", section: "workloads", resource: "pods", namespace: "default", row: { uid: name, name }, drawerTab: "summary" });
  const first = model.upsertResourceWorkspaceTab([], make("a"), 2);
  assert.deepEqual(
    first.tabs.map((tab) => tab.id),
    ["a"],
  );
  const second = model.upsertResourceWorkspaceTab(first.tabs, make("b"), 2);
  assert.deepEqual(
    second.tabs.map((tab) => tab.id),
    ["a", "b"],
  );
  assert.equal(model.upsertResourceWorkspaceTab(second.tabs, make("c"), 2).limited, true);
  assert.deepEqual(
    model.upsertResourceWorkspaceTab(second.tabs, { ...make("a"), drawerTab: "yaml" }, 2).tabs.map((tab) => tab.id),
    ["a", "b"],
  );
  assert.deepEqual(model.closeResourceWorkspaceTab(second.tabs, "b", "b"), { tabs: [make("a")], activeId: "a" });
});

test("closing a background resource tab preserves the transient drawer", () => {
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  const workspaceTabsHook = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceWorkspaceTabs.ts"), "utf8");
  assert.match(workspaceTabsHook, /if \(!closingActiveTab\) return;/);
  assert.match(workspaceTabsHook, /function closeDisplayedResource\(\)/);
  assert.match(app, /onClose=\{closeDisplayedResource\}/);
});

test("resource rows pin workspace tabs only on double click", () => {
  const table = fs.readFileSync(path.join(rendererRoot, "components/ResourceTable.tsx"), "utf8");
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  const workspaceTabsHook = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceWorkspaceTabs.ts"), "utf8");
  assert.match(table, /onDoubleClick=\{\(\) => onPin\?\.\(row\)\}/);
  assert.match(app, /pinNextSelectionRef\.current = true/);
  assert.match(workspaceTabsHook, /if \(!pinNextSelectionRef\.current\) return/);
});

test("workspace callbacks do not create renderer update loops", () => {
  const drawer = fs.readFileSync(path.join(rendererRoot, "components/PodDrawer.tsx"), "utf8");
  const terminal = fs.readFileSync(path.join(rendererRoot, "components/TerminalTab.tsx"), "utf8");
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  assert.match(drawer, /onTabChangeRef\.current\?\.\(tab\), \[tab\]/);
  assert.match(drawer, /onDirtyChangeRef\.current\?\.\(yamlChanged\)/);
  assert.match(terminal, /onStatusChangeRef\.current\?\.\(status\), \[status\]/);
  assert.match(app, /target\.drawerTab === drawerTab \? current/);
});

test("hidden terminals never fit or resize the PTY", () => {
  const terminal = fs.readFileSync(path.join(rendererRoot, "components/TerminalTab.tsx"), "utf8");
  const ssh = fs.readFileSync(path.join(rendererRoot, "components/NodeSshTab.tsx"), "utf8");
  const panel = fs.readFileSync(path.join(rendererRoot, "components/BottomTerminalPanel.tsx"), "utf8");
  const xtermSession = fs.readFileSync(path.join(rendererRoot, "utils/xtermSession.ts"), "utf8");
  assert.match(terminal, /const activeRef = useRef\(active\)/);
  assert.match(terminal, /if \(!activeRef\.current\) return/);
  assert.match(terminal, /bounds\.width <= 0 \|\| bounds\.height <= 0/);
  assert.match(ssh, /const activeRef = useRef\(active\)/);
  assert.match(ssh, /!activeRef\.current \|\| !bounds/);
  assert.match(ssh, /bounds\.width <= 0 \|\| bounds\.height <= 0/);
  assert.match(xtermSession, /lastSize\.cols === cols && lastSize\.rows === rows/);
  assert.match(panel, /active=\{!collapsed && target\.id === activeId\}/);
});

test("activating a saved resource tab preserves the namespace selector", () => {
  const workspaceTabsHook = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceWorkspaceTabs.ts"), "utf8");
  const activation = workspaceTabsHook.slice(workspaceTabsHook.indexOf("const activateResourceTab"), workspaceTabsHook.indexOf("function closeResourceTab"));
  assert.match(activation, /api\.resources\(tab\.clusterId, tab\.resource, tab\.namespace\)/);
  assert.doesNotMatch(activation, /setNamespaceSelection\(tab\.namespace\)/);
  assert.doesNotMatch(activation, /setRows\(/);
});

test("transient resource drawer occupies the workspace content row without saved tabs", () => {
  const styles = fs.readFileSync(path.join(rendererRoot, "styles/drawer.css"), "utf8");
  assert.match(styles, /\.resource-workspace\s*>\s*\.drawer\s*\{[^}]*grid-row:\s*2;/s);
});

test("2.7.6 resource surfaces align compare panes and render compact operational signals", () => {
  const compare = fs.readFileSync(path.join(rendererRoot, "components/ManifestCompare.tsx"), "utf8");
  const table = fs.readFileSync(path.join(rendererRoot, "components/ResourceTable.tsx"), "utf8");
  const summary = fs.readFileSync(path.join(rendererRoot, "components/ResourceSummary.tsx"), "utf8");
  const lifecycle = fs.readFileSync(path.join(rendererRoot, "hooks/usePodDrawerResourceLifecycle.ts"), "utf8");
  assert.match(compare, /target\.scrollTop !== source\.scrollTop/);
  assert.match(compare, /target\.scrollLeft !== source\.scrollLeft/);
  assert.match(compare, /aria-label=\{side === "left" \? "Current manifest" : "Compared manifest"\}/);
  assert.match(table, /<ResourceUsageBar label="CPU"/);
  assert.match(table, /<ResourceUsageBar label="RAM"/);
  assert.match(table, /workload-condition-list/);
  assert.match(table, /nodeLabelItems/);
  assert.match(summary, /formatQuotaQuantity/);
  assert.match(lifecycle, /\.resourceMetrics\(/);
  assert.match(lifecycle, /metricsRequestRef/);
  const model = loadTypeScript("components/ResourceSummary.tsx");
  assert.equal(model.formatQuotaQuantity("requests.memory", "1024Ki"), "1 MiB");
  assert.equal(model.formatQuotaQuantity("requests.memory", "1536Mi"), "1.5 GiB");
  assert.equal(model.formatQuotaQuantity("limits.cpu", "200m"), "200m");
  assert.equal(model.formatQuotaQuantity("pods", "25"), "25");
});

test("2.8.0 usage, local lazy boundaries, folding, and seamless tabs stay contracted", () => {
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  const table = fs.readFileSync(path.join(rendererRoot, "components/ResourceTable.tsx"), "utf8");
  const yamlTab = fs.readFileSync(path.join(rendererRoot, "components/YamlTab.tsx"), "utf8");
  const drawerStyles = fs.readFileSync(path.join(rendererRoot, "styles/drawer.css"), "utf8");
  const terminalStyles = fs.readFileSync(path.join(rendererRoot, "styles/terminal.css"), "utf8");
  const tableColumns = fs.readFileSync(path.join(rendererRoot, "utils/resourceTableColumns.ts"), "utf8");
  const nodeDiskUsage = fs.readFileSync(path.join(rendererRoot, "hooks/useNodeDiskUsage.ts"), "utf8");
  assert.match(tableColumns, /key: "podResources", label: "Usage"/);
  assert.match(app, /onVisibleNodeRows=\{loadVisibleNodeDisk\}/);
  assert.match(nodeDiskUsage, /Promise\.all\(Array\.from\(\{ length: Math\.min\(NODE_DISK_CONCURRENCY, queue\.length\) \}, worker\)\)/);
  assert.match(table, /label="Storage"/);
  assert.match(table, /label="Disk"/);
  assert.match(table, /function PodResourceUsage/);
  assert.match(app, /function LazySurface/);
  const appReturn = app.slice(app.indexOf("return (", app.indexOf("export function App")), app.indexOf('<aside className="sidebar">'));
  assert.doesNotMatch(appReturn, /<Suspense/);
  assert.match(yamlTab, /yamlFoldRegions/);
  assert.match(yamlTab, /Collapse top-level YAML groups/);
  assert.match(drawerStyles, /\.resource-workspace-tab\.active::after/);
  assert.match(terminalStyles, /\.bottom-terminal-tab\.active::after/);
});

test("Help uses runtime version metadata and documents the shared Terminal Workspace", () => {
  const help = fs.readFileSync(path.join(rendererRoot, "components/HelpPanel.tsx"), "utf8");
  const english = JSON.parse(fs.readFileSync(path.join(rendererRoot, "locales/en.json"), "utf8"));
  const russian = JSON.parse(fs.readFileSync(path.join(rendererRoot, "locales/ru.json"), "utf8"));
  assert.match(help, /window\.kubedeck[\s\S]*\.getDesktopInfo\(\)/);
  assert.match(help, /info\.appVersion/);
  assert.doesNotMatch(help, /<dd>\d+\.\d+\.\d+<\/dd>/);
  for (const locale of [english, russian]) {
    assert.match(locale["help.terminal.1"], /Pod Terminal/);
    assert.match(locale["help.terminal.1"], /Node SSH/);
    assert.match(locale["help.terminal.2"], /session|сесси/i);
    assert.match(locale["help.terminal.3"], /height|высот/i);
    assert.match(locale["help.terminal.4"], /never saved|не сохраня/i);
  }
});

test("2.9.0 overview and navigation polish stay contracted", () => {
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  const navigation = fs.readFileSync(path.join(rendererRoot, "navigation.ts"), "utf8");
  const overview = fs.readFileSync(path.join(rendererRoot, "components/OverviewPanel.tsx"), "utf8");
  const settings = fs.readFileSync(path.join(rendererRoot, "components/SettingsPanel.tsx"), "utf8");
  const about = fs.readFileSync(path.join(rendererRoot, "components/AboutPanel.tsx"), "utf8");
  const table = fs.readFileSync(path.join(rendererRoot, "components/ResourceTable.tsx"), "utf8");
  const tableStyles = fs.readFileSync(path.join(rendererRoot, "styles/resource-table.css"), "utf8");
  const overviewStyles = fs.readFileSync(path.join(rendererRoot, "styles/overview.css"), "utf8");
  const terminalStyles = fs.readFileSync(path.join(rendererRoot, "styles/terminal.css"), "utf8");
  const layoutStyles = fs.readFileSync(path.join(rendererRoot, "styles/layout.css"), "utf8");
  const panelStyles = fs.readFileSync(path.join(rendererRoot, "styles/panels.css"), "utf8");
  assert.match(navigation, /id: "overview", icon: LayoutDashboard/);
  assert.doesNotMatch(navigation, /events:\s*\["events"\]/);
  assert.doesNotMatch(navigation, /id: "audit"/);
  assert.match(app, /<OverviewPanel/);
  assert.match(app, /closeTransientDrawerFromBackground/);
  assert.match(overview, /api\.overview\(/);
  assert.match(overview, /clusterProfile/);
  assert.match(overview, /data\.capacity\.views/);
  assert.match(overview, /formatCpuCapacity/);
  assert.match(overview, /function CapacityRings/);
  assert.match(overview, /\(amount\.used \/ amount\.allocatable\) \* 100/);
  assert.match(overview, /\{ id: "storage", label: "Storage"/);
  assert.match(overviewStyles, /\.overview-capacity-rings \.is-storage/);
  assert.match(overview, /view\.key\.slice\(6\) !== view\.label \? view\.key\.slice\(6\) : undefined/);
  assert.match(terminalStyles, /\.themed-select-trigger\s*\{[^}]*display:\s*flex;[^}]*width:\s*100%;/s);
  assert.match(terminalStyles, /\.themed-select-option\s*\{[^}]*display:\s*flex;[^}]*text-align:\s*left;/s);
  assert.match(overviewStyles, /\.overview-capacity-groups\s*\{[^}]*minmax\(min\(400px, 100%\), 1fr\)/s);
  assert.match(overviewStyles, /\.overview-capacity-group\s*\{[^}]*container-type:\s*inline-size;/s);
  assert.match(overviewStyles, /@container \(max-width:\s*360px\)[^}]*\.overview-capacity-visual\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  assert.match(overview, /capacityControlPlane/);
  assert.match(overview, /if \(requestRef\.current === controller\) \{\s*requestRef\.current = null;\s*if \(!silent\) setLoading\(false\);/);
  assert.doesNotMatch(overview, /cpuPercent|memoryPercent/);
  assert.doesNotMatch(overview, /priorityProblems|namespaceHotspots|recentEvents/);
  assert.match(settings, /settings\.localActivity/);
  assert.match(settings, /showLocalActivity \? <AuditPanel/);
  assert.doesNotMatch(about, /about\.python|package:win|1\.1\.0/);
  assert.match(about, /className="about-badge"/);
  assert.match(about, /about-action-button about-refresh-button/);
  assert.match(about, /about-action-button about-copy-button/);
  assert.doesNotMatch(panelStyles, /\.about-hero span\s*\{/);
  assert.match(layoutStyles, /\.icon-text,\s*\.secondary-btn,/);
  assert.match(panelStyles, /\.about-actions > button\.about-action-button\s*\{[^}]*height:\s*36px;[^}]*font-size:\s*13px;/s);
  assert.match(panelStyles, /@media \(max-width:\s*1100px\)[\s\S]*\.about-actions\s*\{[^}]*width:\s*max-content;[^}]*justify-content:\s*flex-start;/);
  assert.match(table, /className="table-view-controls"[\s\S]*className="table-filter"[\s\S]*<ResourceTableColumnsMenu/);
  assert.match(tableStyles, /\.table-view-controls\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/s);
});

test("YAML folding preserves full source and hides only collection descendants", () => {
  const model = loadTypeScript("utils/yamlFolding.ts", { yaml: require("yaml") });
  const source = "apiVersion: v1\nmetadata:\n  name: demo\n  labels:\n    app: demo\nspec:\n  containers:\n    - name: app\n";
  const regions = model.yamlFoldRegions(source);
  const metadata = regions.find((region) => region.label === "metadata");
  assert.ok(metadata);
  const visible = model.visibleYamlLines(source, regions, new Set([metadata.path]));
  assert.equal(
    visible.some((line) => line.line.includes("name: demo")),
    false,
  );
  assert.equal(source.includes("name: demo"), true);
  assert.deepEqual(model.yamlFoldRegions("metadata:\n  name: ["), []);
});

test("YAML edit segments stay editable around a fold and always reconstruct the exact source", () => {
  const model = loadTypeScript("utils/yamlFolding.ts", { yaml: require("yaml") });
  const source =
    "apiVersion: v1\nkind: Pod\nmetadata:\n  name: demo\n  labels:\n    app: demo\n    tier: backend\nspec:\n  containers:\n    - name: app\n      image: nginx\nstatus:\n  phase: Running\n";
  const regions = model.yamlFoldRegions(source);
  const metadata = regions.find((region) => region.label === "metadata");
  const labels = regions.find((region) => region.label === "labels");

  // Nothing collapsed: the whole document is one editable run.
  const flat = model.yamlEditSegments(source, regions, new Set());
  assert.deepEqual(
    flat.map((segment) => segment.kind),
    ["text"],
  );
  assert.equal(model.joinYamlEditSegments(flat), source);

  // Collapsing "metadata" hides it behind a summary but keeps editing on both
  // sides of it, and a round trip through join must reproduce the source
  // untouched, including the lines a summary row never shows.
  const withMetadataFolded = model.yamlEditSegments(source, regions, new Set([metadata.path]));
  assert.deepEqual(
    withMetadataFolded.map((segment) => segment.kind),
    ["text", "folded", "text"],
  );
  const editableText = withMetadataFolded
    .filter((segment) => segment.kind === "text")
    .map((segment) => segment.text)
    .join("\n");
  assert.equal(editableText.includes("name: demo"), false, "a collapsed region's lines must not be part of any editable segment");
  assert.equal(model.joinYamlEditSegments(withMetadataFolded), source);

  // Collapsing only the nested "labels" region leaves its parent "metadata"
  // editable, so "name: demo" (a sibling of labels) stays editable while
  // "app: demo" (inside labels) is hidden.
  const withLabelsFolded = model.yamlEditSegments(source, regions, new Set([labels.path]));
  const editableWithLabelsFolded = withLabelsFolded
    .filter((segment) => segment.kind === "text")
    .map((segment) => segment.text)
    .join("\n");
  assert.equal(editableWithLabelsFolded.includes("name: demo"), true);
  assert.equal(editableWithLabelsFolded.includes("app: demo"), false);
  assert.equal(model.joinYamlEditSegments(withLabelsFolded), source);

  // Collapsing every top-level section (what "Collapse top-level groups" does)
  // still reconstructs the exact source; "apiVersion"/"kind" before the first
  // section and the trailing newline after the last stay their own editable runs.
  const minimumDepth = Math.min(...regions.map((region) => region.depth));
  const allTopLevel = new Set(regions.filter((region) => region.depth === minimumDepth).map((region) => region.path));
  const collapsedAll = model.yamlEditSegments(source, regions, allTopLevel);
  assert.deepEqual(
    collapsedAll.map((segment) => segment.kind),
    ["text", "folded", "folded", "folded", "text"],
  );
  assert.equal(model.joinYamlEditSegments(collapsedAll), source);

  // Editing one segment's text and rejoining must only change that segment,
  // leaving a folded region's original text (and everything else) untouched.
  const edited = withMetadataFolded.map((segment, index) => (index === 0 ? { ...segment, text: "apiVersion: v2\nkind: Pod" } : segment));
  assert.equal(model.joinYamlEditSegments(edited), source.replace("apiVersion: v1", "apiVersion: v2"));
});

test("the YAML tab is editable immediately, with no separate fold-view mode to switch out of", () => {
  const yamlTab = fs.readFileSync(path.join(rendererRoot, "components/YamlTab.tsx"), "utf8");
  const drawerStyles = fs.readFileSync(path.join(rendererRoot, "styles/drawer.css"), "utf8");

  // The old "Edit full YAML" toggle (and the state it flipped) is gone -
  // there is nothing to click before the manifest becomes editable.
  assert.doesNotMatch(yamlTab, /useState\(false\)[^;]*editing|\[editing, setEditing\]/);
  assert.doesNotMatch(yamlTab, /Edit full YAML|Open fold view|<Pencil/);
  assert.doesNotMatch(yamlTab, /function FoldedYamlView/);

  // Collapsing/expanding groups is always available, not just in a read-only mode.
  assert.doesNotMatch(yamlTab, /disabled=\{editing/);
  assert.match(yamlTab, /disabled=\{collapsed\.size === 0\}/);

  // Collapse replaces the whole set, so it must also grey out once everything
  // it would collapse is already collapsed - not only when the manifest has no
  // groups at all, which left it lit up after a click that changed nothing.
  assert.match(yamlTab, /disabled=\{collapseIsNoOp\}/);
  assert.doesNotMatch(yamlTab, /disabled=\{foldRegions\.length === 0\}/);
  assert.match(yamlTab, /collapsed\.size === topLevelFoldPaths\.length && topLevelFoldPaths\.every\(\(path\) => collapsed\.has\(path\)\)/);

  // A collapsed region renders as a summary row; everything else is one of
  // possibly several editable text blocks, each its own YamlSourceEditor.
  assert.match(yamlTab, /function FoldedYamlEditor/);
  assert.match(yamlTab, /yamlEditSegments\(value, regions, collapsed\)/);
  assert.match(yamlTab, /segment\.kind === "folded"/);
  assert.match(yamlTab, /<YamlSourceEditor value=\{segment\.text\}/);
  assert.match(yamlTab, /joinYamlEditSegments\(next\)/);

  // A nested region that is still expanded gets its own fold toggle inside
  // the shared text block instead of losing the ability to be collapsed.
  assert.match(yamlTab, /yaml-fold-gutter-button-nested/);

  // The searched-for match forces every fold open before selecting into the
  // (now single) text block, rather than switching some separate raw mode.
  const jumpMatch = yamlTab.slice(yamlTab.indexOf("function jumpMatch"), yamlTab.indexOf("function toggleFold"));
  assert.match(jumpMatch, /setCollapsed\(new Set\(\)\)/);
  assert.doesNotMatch(jumpMatch, /setEditing/);

  // .yaml-line's own `display: inline` (defined later in the stylesheet, same
  // specificity as a bare .yaml-fold-summary-line rule) would otherwise win
  // the cascade and silently break the summary row's flex layout.
  assert.match(drawerStyles, /\.yaml-line\.yaml-fold-summary-line\s*\{[^}]*display:\s*inline-flex;/s);

  // Only the outer .yaml-fold-view scrolls. Sizing a segment from a line count
  // times a line height put a second scrollbar inside every segment, because a
  // fractional line box (12px * 1.35) rounds up per line and the accumulated
  // overflow re-armed the inner `overflow: auto`. The highlight layer is put
  // back in normal flow so it, not arithmetic, sizes the box.
  assert.doesNotMatch(yamlTab, /--yaml-segment-lines/, "a segment must not be sized from a hand-computed line count");
  assert.doesNotMatch(drawerStyles, /--yaml-segment-lines/);
  assert.match(drawerStyles, /--yaml-line-height:\s*\d+px;/, "the fold gutter steps by an exact pixel line height, not a rounding-prone ratio");
  assert.match(drawerStyles, /\.yaml-segment-editor \.yaml-ide-editor\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(drawerStyles, /\.yaml-segment-editor \.yaml-highlight-layer\s*\{[^}]*position:\s*relative;/s);
  // The caret layer is absolute with inset: 0, so it must not also carry
  // .yaml-editor's content-box `width: 100%`, which adds its padding on top.
  assert.match(drawerStyles, /\.yaml-segment-editor \.yaml-editor-input\s*\{[^}]*width:\s*auto;[^}]*height:\s*auto;/s);
});

test("lazy panel boundary resets its failure after navigation", () => {
  class Component {
    constructor(props) {
      this.props = props;
      this.state = {};
    }
    setState(next) {
      this.state = { ...this.state, ...next };
    }
  }
  const model = loadTypeScript("components/LazyPanelBoundary.tsx", { react: { Component } });
  const boundary = new model.LazyPanelBoundary({ resetKey: "settings", children: null });
  boundary.state = { failed: true };
  boundary.props = { resetKey: "about", children: null };
  boundary.componentDidUpdate({ resetKey: "settings", children: null });
  assert.equal(boundary.state.failed, false);
});

test("renderer error normalizer preserves ApiError fields and redacts sensitive fallbacks", () => {
  class ApiError extends Error {
    constructor(info) {
      super(info.message);
      this.info = info;
    }
  }
  const model = loadTypeScript("utils/errors.ts", { "../api": { ApiError } });
  const apiInfo = { code: "FORBIDDEN", message: "Denied", rawStderr: "safe diagnostic", commandPreview: "kubectl auth can-i" };
  assert.deepEqual(model.toErrorInfo(new ApiError(apiInfo)), apiInfo);
  const fallback = model.toErrorInfo(new Error("Authorization Bearer super-secret-token"));
  assert.equal(fallback.message, "Sensitive error details were redacted");
  assert.doesNotMatch(JSON.stringify(fallback), /super-secret-token/);
  assert.equal(model.toErrorInfo({ message: "timeout", rawStderr: "password=hunter2" }).rawStderr, "Sensitive error details were redacted");
});

test("the drawer tab is remembered per resource and dropped for kinds that lack it", () => {
  const model = loadTypeScript("utils/workspaceTabs.ts");
  assert.equal(model.drawerTabForResource({}, "pods"), "summary");
  const afterYaml = model.rememberDrawerTab({}, "pods", "yaml");
  assert.equal(model.drawerTabForResource(afterYaml, "pods"), "yaml");
  assert.equal(model.drawerTabForResource(afterYaml, "services"), "summary");
  assert.equal(model.rememberDrawerTab(afterYaml, "pods", "yaml"), afterYaml, "an unchanged tab must not produce a new object");
  assert.equal(model.rememberDrawerTab(afterYaml, "", "yaml"), afterYaml);
  assert.equal(model.drawerTabForResource(model.rememberDrawerTab(afterYaml, "secrets", "secret"), "secrets"), "secret");

  const hook = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceWorkspaceTabs.ts"), "utf8");
  assert.match(hook, /drawerTab: drawerTabForResource\(drawerTabMemory, currentSelectedTarget\.resource\)/);
  assert.match(hook, /drawerTab: drawerTabForResource\(drawerTabMemory, selectedTarget\.resource\)/);

  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  assert.match(app, /rememberResourceDrawerTab\(displayedResourceWorkspaceTab\.resource, drawerTab\);/);

  const drawer = fs.readFileSync(path.join(rendererRoot, "components/PodDrawer.tsx"), "utf8");
  assert.match(drawer, /const resolvedInitialTab: DrawerTab = drawerTabs\.includes\(initialTab\) \? initialTab : "summary";/);
  assert.match(drawer, /useEffect\(\(\) => setTab\(resolvedInitialTab\), \[currentObjectKey, resolvedInitialTab\]\);/);
});

test("the usage history panel refreshes itself instead of freezing on its first read", () => {
  const lifecycle = fs.readFileSync(path.join(rendererRoot, "hooks/usePodDrawerResourceLifecycle.ts"), "utf8");
  const chart = fs.readFileSync(path.join(rendererRoot, "components/UsageHistoryChart.tsx"), "utf8");

  // History keeps growing while the drawer is open, but none of the fetch's
  // other dependencies ever change, so without a tick the panel would keep
  // showing its first read - including "no samples yet" for a pod whose
  // samples have since arrived.
  assert.match(lifecycle, /const USAGE_HISTORY_REFRESH_MS = 15_000;/);
  assert.match(lifecycle, /setAlignedInterval\(\(\) => setUsageHistoryTick\(\(current\) => current \+ 1\), USAGE_HISTORY_REFRESH_MS\)/);

  // Free-running timers leave the table and the drawer up to a full interval
  // apart, which reads as the two panels disagreeing about one pod.
  const aligned = fs.readFileSync(path.join(rendererRoot, "utils/alignedInterval.ts"), "utf8");
  assert.match(aligned, /intervalMs - \(Date\.now\(\) % intervalMs\)/);
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  assert.match(app, /setAlignedInterval\(\(\) => void refresh\(\), POD_USAGE_REFRESH_MS\)/);
  const fetchEffect = lifecycle.slice(lifecycle.indexOf("Usage history is recorded by KubeDeck itself"), lifecycle.indexOf('tab !== "related"'));
  assert.match(fetchEffect, /usageHistoryTick\]/, "the fetch must depend on the tick or it never runs again");
  assert.match(fetchEffect, /requestGeneration === usageHistoryRequestRef\.current/, "a stale response must not land on another pod");

  // The empty state has to explain the two reasons it can be empty.
  assert.match(chart, /metrics-server itself needs two scrapes/);
  assert.match(chart, /refreshes on its own/);
});

test("the service summary renders endpoints loaded outside the Service object", () => {
  const lifecycle = fs.readFileSync(path.join(rendererRoot, "hooks/usePodDrawerResourceLifecycle.ts"), "utf8");
  const endpointsEffect = lifecycle.slice(lifecycle.indexOf("isServiceResource(resource)"), lifecycle.indexOf('tab !== "related"'));
  assert.match(endpointsEffect, /api\s*\.serviceEndpoints\(clusterId, resource, podNamespace, podName, controller\.signal\)/);
  assert.match(endpointsEffect, /requestGeneration === endpointsRequestRef\.current/, "a stale response must not land on another object");
  assert.match(endpointsEffect, /\.catch\(\(\) => undefined\)/, "a refused endpoint lookup must not replace the summary with an error");
  assert.match(lifecycle, /serviceEndpoints: snapshotIsCurrent \? serviceEndpoints : null/);

  const drawer = fs.readFileSync(path.join(rendererRoot, "components/PodDrawer.tsx"), "utf8");
  assert.match(drawer, /<ResourceSummary [^>]*serviceEndpoints=\{serviceEndpoints\}/);

  const summary = fs.readFileSync(path.join(rendererRoot, "components/ResourceSummary.tsx"), "utf8");
  assert.match(summary, /addFact\(facts, "Ready endpoints", `\$\{serviceEndpoints\.ready\} \/ \$\{serviceEndpoints\.total\}`/);
  assert.match(summary, /\{serviceEndpoints \? <ServiceEndpoints data=\{serviceEndpoints\} \/> : null\}/);
  assert.match(summary, /No endpoints back this service/);
  assert.match(summary, /\+\{data\.total - data\.items\.length\} more endpoints not listed/);

  const styles = fs.readFileSync(path.join(rendererRoot, "styles/resource-summary-polish.css"), "utf8");
  assert.match(styles, /\.summary-endpoint-main \{/);
  assert.match(styles, /\.summary-endpoint-detail \{/);
});

test("recorded usage patches only the usage fields and keeps unchanged rows identical", () => {
  const model = loadTypeScript("utils/podUsagePatch.ts");
  const rows = [
    { uid: "1", name: "api-1", namespace: "default", phase: "Running", podCpuLimitValue: 1000, podCpuRequestValue: 200, podMemoryLimitValue: 1073741824, podMemoryRequestValue: 536870912 },
    { uid: "2", name: "other", namespace: "default", phase: "Running", cpuUsage: "9m" },
  ];

  const patched = model.applyPodUsage(rows, [{ namespace: "default", pod: "api-1", cpu: "250m", memory: "512Mi", cpuMillicores: 250, memoryBytes: 536870912 }]);
  const api = patched[0];
  assert.equal(api.cpuUsage, "250m");
  assert.equal(api.memoryUsage, "512Mi");
  assert.equal(api.podCpuUsageValue, 250);
  // Mirrors the backend: clamped against the limit, unclamped against the
  // request, because a request is a scheduling floor rather than a ceiling.
  assert.equal(api.podCpuUsagePercent, 25);
  assert.equal(api.podCpuRequestPercent, 125);
  assert.equal(api.podMemoryUsagePercent, 50);
  assert.equal(api.podMemoryRequestPercent, 100);
  // Everything that belongs to the list response survives.
  assert.equal(api.phase, "Running");
  assert.equal(api.uid, "1");
  // A row with no entry is the very same object.
  assert.equal(patched[1], rows[1]);

  // A refresh that changes nothing must not produce a new array, or the table
  // would re-render every 30 seconds for no reason.
  const unchanged = model.applyPodUsage(patched, [{ namespace: "default", pod: "api-1", cpu: "250m", memory: "512Mi", cpuMillicores: 250, memoryBytes: 536870912 }]);
  assert.equal(unchanged, patched);
  assert.equal(model.applyPodUsage(rows, []), rows);

  // A pod of the same name in another namespace must not be matched.
  const crossNamespace = model.applyPodUsage(rows, [{ namespace: "other-ns", pod: "api-1", cpu: "1m", memory: "1Mi", cpuMillicores: 1, memoryBytes: 1048576 }]);
  assert.equal(crossNamespace, rows);

  // A half-missing reading leaves the percentage null rather than zero.
  const cpuOnly = model.applyPodUsage(rows, [{ namespace: "default", pod: "api-1", cpu: "250m", memory: "", cpuMillicores: 250, memoryBytes: null }]);
  assert.equal(cpuOnly[0].podMemoryUsagePercent, null);
  assert.equal(cpuOnly[0].memoryUsage, "");
});

test("the pods table refreshes usage from recorded samples rather than reloading the list", () => {
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  // A table driven by watch events is not reloaded while the pods do not
  // change, so its usage column froze at whatever the last list load caught.
  assert.match(app, /const POD_USAGE_REFRESH_MS = 15_000;/);
  assert.match(app, /api\.podUsage\(activeCluster\.id/);
  assert.match(app, /applyPodUsage\(rows, response\.items\)/);
  // Reloading the list would mean another `kubectl get pods` every tick, which
  // is what moving from polling to watch was avoiding.
  const effectStart = app.indexOf("A pods table driven by watch events");
  const effectEnd = app.indexOf("}, [api, activeCluster?.id, resourceTab, selectedNamespaces, connectedClusterIds]);");
  assert.ok(effectStart >= 0 && effectEnd > effectStart, "the usage refresh effect must still be recognisable");
  const effect = app.slice(effectStart, effectEnd);
  assert.doesNotMatch(effect, /loadResources/);
  assert.match(effect, /return next === rows \? current :/, "an unchanged refresh must not replace the rows");

  // A disconnected cluster has nothing recorded to read, and polling it would
  // undo half of what disconnecting is for.
  assert.match(effect, /connectedClusterIds\.includes\(activeCluster\.id\)/);
});

test("the usage chart can be read at the rate metrics-server publishes without losing the day view", () => {
  const chart = fs.readFileSync(path.join(rendererRoot, "components/UsageHistoryChart.tsx"), "utf8");

  // The live tail is what the panel is opened for, so it is the default.
  assert.match(chart, /useState<Range>\("fine"\)/);
  assert.match(chart, /range === "fine" && fineAvailable \? finePoints : history\.points/);

  // A response without the field must not blank the drawer.
  assert.match(chart, /history\.finePoints \?\? \[\]/);

  // The toggle only appears once there is something finer to show.
  assert.match(chart, /fineAvailable \?\s*\(/);

  // The percentiles describe the whole recorded window whichever view is on
  // screen; two different p95 values for one pod would be worse than none.
  assert.match(chart, /over the whole window/);
  assert.match(chart, /points=\{points\}/);
});

test("a bar holding one scrape reports one number instead of the same number twice", () => {
  const chart = fs.readFileSync(path.join(rendererRoot, "components/UsageHistoryChart.tsx"), "utf8");

  // "avg 3 GiB · max 3 GiB" is what a 15-second bucket produces, because after
  // deduplication it holds exactly one measurement.
  assert.match(chart, /if \(point\.samples <= 1\) return `\$\{time\} · \$\{average\}`;/);
  assert.match(chart, /avg \$\{average\} · max \$\{peak\} · \$\{point\.samples\} samples/);
  assert.match(chart, /title=\{pointTitle\(point, format\(average\), format\(peak\)\)\}/);
});

test("a disconnected cluster is left alone, including by the polling fallback", () => {
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  const rail = fs.readFileSync(path.join(rendererRoot, "components/ClusterRail.tsx"), "utf8");

  // Polling exists for when watches are down. Disconnecting takes them down on
  // purpose, so without this guard a disconnect would be answered with a full
  // `kubectl get` on a timer - louder than what the user asked to stop.
  const pollEffect = app.slice(app.indexOf("const intervalSeconds = getAutoRefreshIntervalSeconds(settings);") - 400, app.indexOf("shouldPollResources(intervalSeconds, watchHealthy)"));
  assert.match(pollEffect, /connectedClusterIds\.includes\(activeCluster\.id\)/);

  // A watch is a long-lived kubectl process, so a disconnected cluster must not
  // have one opened for it. This was the hole that made disconnect look like it
  // had not worked: watches came straight back and kept talking to the cluster.
  assert.match(app, /const activeClusterConnected = Boolean\(activeCluster && connectedClusterIds\.includes\(activeCluster\.id\)\)/);
  assert.match(app, /enabled: isResourceTableView && activeClusterConnected/);

  // The table used to keep showing rows loaded before the disconnect, with
  // every action still on offer against a cluster the gateway now refuses.
  assert.match(app, /\{activeCluster && activeClusterConnected \? \(/);
  assert.match(app, /<DisconnectedClusterPanel/);
  // Saving settings replaces the whole config from the PUT response. An absent
  // connection list means "not reported", not "nothing connected" - conflating
  // them turned the entire rail grey while the backend kept talking.
  assert.match(app, /connectedClusterIds: updated\.connectedClusterIds \?\? current\?\.connectedClusterIds \?\? \[\]/);

  // Left click connects, right click offers the menu.
  assert.match(rail, /onContextMenu=\{\(event\) => \{/);
  assert.match(rail, /connected\.has\(cluster\.id\) \? "connected" : "disconnected"/);

  // The state is a badge rather than a ring on the button. A ring lost to
  // `.cluster-rail-item.is-active`, which sets its own box-shadow later in the
  // stylesheet, so the one cluster being looked at showed no state at all.
  assert.match(rail, /<span className="cluster-rail-state"/);
  const layout = fs.readFileSync(path.join(rendererRoot, "styles/layout.css"), "utf8");
  assert.doesNotMatch(layout, /\.cluster-rail-item\.is-connected \{\s*box-shadow/, "a ring here would be overridden by is-active");
  assert.match(layout, /\.cluster-rail-item\.is-connected \.cluster-rail-state/);
  assert.match(layout, /\.cluster-rail-item\.is-disconnected \{[^}]*grayscale/, "colour alone is too weak on a column of small buttons");
  assert.match(rail, /disabled=\{connected\.has\(menu\.cluster\.id\)\}/, "Connect is unavailable for an already connected cluster");
  assert.match(rail, /disabled=\{!connected\.has\(menu\.cluster\.id\)\}/, "Disconnect is unavailable for a disconnected one");

  // A cluster can be active and disconnected at the same time; clicking it then
  // has to reconnect rather than being treated as already open.
  assert.match(app, /cluster\.id === activeCluster\?\.id && connectedClusterIds\.includes\(cluster\.id\)/);

  // Disconnect is never forced on the first attempt.
  const controller = fs.readFileSync(path.join(rendererRoot, "hooks/useClusterController.ts"), "utf8");
  assert.match(controller, /api\.disconnectCluster\(cluster\.id, force\)/);
  assert.match(controller, /setDisconnectTarget\(\{ cluster, sessions: result\.sessions \}\)/);

  // Rows loaded before the disconnect are stale by definition, and an open
  // drawer would keep offering actions the gateway now refuses.
  assert.match(controller, /if \(cluster\.id === activeCluster\?\.id\) \{\s*setRows\(\{\}\);\s*setSelectedRow\(null\);/);
});

test("the problems panel sizes itself by its own width, not the window's", () => {
  const problems = fs.readFileSync(path.join(rendererRoot, "styles/problems-panel.css"), "utf8");
  const panels = fs.readFileSync(path.join(rendererRoot, "styles/panels.css"), "utf8");

  // The panel is squeezed by the drawer, not by the window. A viewport media
  // query cannot see that, so on a wide screen with the drawer open the card
  // kept two columns, the button column took its max-content width, and the
  // text column collapsed until `overflow-wrap: anywhere` broke the resource
  // path one character per line.
  assert.match(problems, /\.problems-priority \{[^}]*container-type: inline-size/);
  assert.match(problems, /@container problems-priority \(max-width: 1050px\)[\s\S]*?\.problems-priority-list/);
  assert.match(problems, /@container problems-priority \(max-width: 560px\)[\s\S]*?\.problem-priority-card/);
  assert.doesNotMatch(problems, /@media[^{]*\{\s*\.problems-priority-list/, "the list must not key off the viewport again");
  assert.doesNotMatch(problems, /@media[^{]*\{\s*\.problem-priority-card/, "nor the card");

  assert.match(panels, /\.problems-guidance \{[^}]*container-type: inline-size/);
  assert.match(panels, /@container problems-guidance \(max-width: 1050px\)/);
  assert.doesNotMatch(panels, /@media[^{]*\{\s*\.problems-guidance-grid/);

  // The summary row needs no query at all - auto-fit follows the space that is
  // actually there.
  assert.match(problems, /\.problem-summary-grid \{[^}]*repeat\(auto-fit, minmax\(160px, 1fr\)\)/);
  assert.doesNotMatch(problems, /@media[^{]*\{\s*\.problem-summary-grid/);
});

test("every ANSI colour stays readable against its own terminal background", () => {
  const theme = fs.readFileSync(path.join(rendererRoot, "utils/terminalTheme.ts"), "utf8");
  const slots = [
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
    "brightBlack",
    "brightRed",
    "brightGreen",
    "brightYellow",
    "brightBlue",
    "brightMagenta",
    "brightCyan",
    "brightWhite",
  ];

  // xterm fills anything left out from its own palette, which assumes a dark
  // background. Leaving the eight bright slots unset put #eeeeec on the light
  // theme's #f5f7fa background, so `top`, which prints its summary values in
  // bold white, rendered them invisible.
  for (const slot of slots) {
    assert.match(theme, new RegExp("\\b" + slot + ": token\\("), slot + " must be given to xterm explicitly");
  }

  const lines = fs.readFileSync(path.join(rendererRoot, "styles/tokens.css"), "utf8").split(String.fromCharCode(13)).join("").split(String.fromCharCode(10));
  const themes = {};
  let current = null;
  for (const line of lines) {
    if (line.endsWith("{")) {
      const named = line.match(/data-theme="([a-z]+)"/);
      current = named ? named[1] : line.startsWith(":root") ? "root" : null;
      if (current && !themes[current]) themes[current] = {};
      continue;
    }
    if (line.startsWith("}")) current = null;
    if (!current) continue;
    const declaration = line.match(/(--[a-z-]+):\s*([^;]+);/);
    if (declaration) themes[current][declaration[1]] = declaration[2].trim();
  }

  const luminance = (hex) => {
    const h = hex.replace("#", "");
    const channels = [0, 2, 4].map((i) => Number.parseInt(h.substr(i, 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const base = { ...themes.root, ...themes.midnight };
  const cssSlots = slots.map((slot) => "--terminal-" + slot.replace(/([A-Z])/g, (m) => "-" + m.toLowerCase()));

  for (const name of ["midnight", "graphite", "nord", "forest", "plum", "mocha", "light"]) {
    const resolved = { ...base, ...(themes[name] ?? {}) };
    const background = resolved["--terminal-bg"];
    assert.ok(background, name + " must define a terminal background");
    const dark = luminance(background) < 0.2;
    for (const slot of cssSlots) {
      const colour = resolved[slot];
      assert.ok(colour && colour.startsWith("#"), name + " is missing " + slot);
      // ANSI black is meant to sit near a dark background; that is the palette
      // working rather than a defect.
      if (dark && slot === "--terminal-black") continue;
      const ratio = contrast(colour, background);
      assert.ok(ratio >= 2, name + " " + slot + " " + colour + " is " + ratio.toFixed(2) + ":1 against " + background);
    }
  }
});

test("finding in YAML scrolls the container that actually scrolls", () => {
  const yamlTab = fs.readFileSync(path.join(rendererRoot, "components/YamlTab.tsx"), "utf8");

  // The textarea stopped being the scroll container when the folding editor
  // arrived: it is sized to its content with overflow hidden, and
  // `.yaml-fold-view` scrolls instead. Writing scrollTop on the textarea was a
  // silent no-op, so the match counter advanced while the view never moved.
  assert.doesNotMatch(yamlTab, /element\.scrollTop\s*=/, "the textarea does not scroll");
  assert.match(yamlTab, /element\.closest\("\.yaml-fold-view"\)/);
  assert.match(yamlTab, /container\.scrollTop \+=/);

  // Measured from the DOM rather than multiplied by a line height: fold rows
  // and segment boundaries make the document taller than its line count.
  assert.match(yamlTab, /function lineRow\(container: HTMLElement, line: number\)/);
  assert.match(yamlTab, /number\.textContent === String\(line\)/);

  // Clearing the folds re-renders the editor, so the jump has to run after that
  // commit. A requestAnimationFrame scheduled alongside the setState is not
  // ordered against it.
  assert.match(yamlTab, /setJumpRequest\(\(current\) => current \+ 1\)/);
  assert.match(yamlTab, /\}, \[jumpRequest\]\);/);
  assert.doesNotMatch(yamlTab, /window\.requestAnimationFrame\(/);

  // Focus must not scroll on its own or it fights the deliberate scroll.
  assert.match(yamlTab, /element\.focus\(\{ preventScroll: true \}\)/);
});

test("the prompt preview can be hidden while an analysis is still running", () => {
  const llmTab = fs.readFileSync(path.join(rendererRoot, "components/LlmTab.tsx"), "utf8");

  // Hiding an open prompt is local: the handler closes it and returns without
  // touching the network. Tying the button to the shared busy flag left the
  // prompt stuck on screen for as long as the model took to answer.
  assert.match(llmTab, /togglePromptPreview\(\)\} disabled=\{promptPreviewLoading\}/);
  assert.doesNotMatch(llmTab, /togglePromptPreview\(\)\} disabled=\{busy\}/);

  // Starting a second analysis while one is in flight stays blocked.
  assert.match(llmTab, /analyze\(\)\} disabled=\{busy\}/);
  assert.match(llmTab, /const busy = loading \|\| promptPreviewLoading;/);

  // The early return is what makes hiding free; if it ever goes, the button
  // would be waiting on a request again.
  assert.match(llmTab, /if \(promptPreviewOpen\) \{\s*setPromptPreviewOpen\(false\);\s*return;/);
});

test("About and Help describe the application as it actually behaves", () => {
  const about = fs.readFileSync(path.join(rendererRoot, "components/AboutPanel.tsx"), "utf8");
  const help = fs.readFileSync(path.join(rendererRoot, "components/HelpPanel.tsx"), "utf8");
  const ru = JSON.parse(fs.readFileSync(path.join(rendererRoot, "locales/ru.json"), "utf8"));
  const en = JSON.parse(fs.readFileSync(path.join(rendererRoot, "locales/en.json"), "utf8"));

  // KubeDeck is Apache-2.0 and redistributes third-party components. None of
  // that was visible in the packaged application - only in repository files,
  // which someone running the portable exe does not have.
  assert.match(about, /Apache License 2\.0/);
  assert.match(about, /Copyright 2026 Maksim Pronin/, "must match NOTICE verbatim");
  assert.match(about, /about\.thirdParty/);

  // The copied diagnostics answer "why is nothing updating" and "is the model
  // configured". The LLM status shape carries no key and must not gain one.
  assert.match(about, /connected: \(config\.connectedClusterIds \?\? \[\]\)\.includes\(cluster\.id\)/);
  assert.match(about, /llm: backendInfo\?\.settings\.llm \?\? null/);
  assert.doesNotMatch(about, /apiKey/);

  // Clusters moved to the left rail several releases ago; the quick start still
  // sent people to a top-bar dropdown that no longer exists.
  for (const locale of [ru, en]) {
    assert.doesNotMatch(locale["help.quickStart.2"], /верхней панели|top bar/i);
    assert.match(locale["help.quickStart.2"], /рельс|rail/i);
  }

  // Everything the last releases added has to be findable here.
  const helpKeys = [
    "help.connection.1",
    "help.connection.2",
    "help.connection.3",
    "help.connection.4",
    "help.connection.5",
    "help.quickStart.5",
    "help.drawer.5",
    "help.drawer.6",
    "help.drawer.7",
    "help.sections.6",
    "help.sections.7",
  ];
  for (const key of helpKeys) {
    for (const [name, locale] of [
      ["ru", ru],
      ["en", en],
    ]) {
      assert.ok(typeof locale[key] === "string" && locale[key].length > 0, `${name}.json is missing ${key}`);
    }
  }
  assert.match(help, /help\.connection\.5/, "the connection card must render every line it defines");
  assert.match(help, /help\.drawer\.7/);
  assert.match(help, /help\.sections\.7/);
  assert.match(help, /help\.quickStart\.5/);
});
