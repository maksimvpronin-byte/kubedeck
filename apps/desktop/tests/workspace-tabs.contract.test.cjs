// Workspace resource tabs and the bottom terminal workspace.
// Split out of renderer-controllers.contract.test.cjs; see
// docs/file-structure-refactor-plan.md, section C.
// A test marked `grep contract` reads a source file and asserts on its text.
// It breaks on a rename and passes through a real regression, so it is a
// placeholder for a behavioural test rather than one. See section C of
// docs/file-structure-refactor-plan.md.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTypeScript, rendererRoot } = require("./helpers/renderer.cjs");

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

// grep contract: asserts on source text, not behaviour.
// Stays one, and here is why. That closing a background tab leaves the drawer
// alone is checked by driving the hook in workspace-tabs-dom.contract.test.cjs.
// What is left is which handler App.tsx hands to the drawer's close button, and
// finding that out by clicking would mean mounting the whole application.
test("the drawer's close button is wired to the workspace-aware handler", () => {
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  assert.match(app, /onClose=\{closeDisplayedResource\}/);
});

// grep contract: asserts on source text, not behaviour.
// Stays one, and here is why. Both halves are checked by clicking now - that a
// double click pins and a single click does not, in
// resource-table-dom.contract.test.cjs, and that the hook pins only when the
// flag is set, in workspace-tabs-dom.contract.test.cjs. What is left is the
// wire between them, which lives in App.tsx.
test("a double click is what raises the pin flag", () => {
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  assert.match(app, /pinNextSelectionRef\.current = true/);
});

// grep contract: asserts on source text, not behaviour.
// Stays one, and here is why. The failure this guards against is not a wrong
// value but a loop: an effect whose dependency it also sets, re-running for
// ever. A test cannot assert on that - it does not fail, it hangs, and a suite
// that hangs reports the file rather than the reason. What holds the line is
// the shape of the code: a callback read through a ref cannot be a dependency.
test("workspace callbacks do not create renderer update loops", () => {
  const drawer = fs.readFileSync(path.join(rendererRoot, "components/PodDrawer.tsx"), "utf8");
  const terminal = fs.readFileSync(path.join(rendererRoot, "components/TerminalTab.tsx"), "utf8");
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  assert.match(drawer, /onTabChangeRef\.current\?\.\(tab\), \[tab\]/);
  assert.match(drawer, /onDirtyChangeRef\.current\?\.\(yamlChanged\)/);
  assert.match(terminal, /onStatusChangeRef\.current\?\.\(status\), \[status\]/);
  assert.match(app, /target\.drawerTab === drawerTab \? current/);
});

// grep contract: asserts on source text, not behaviour.
// Stays one, and here is why. Fitting a terminal means measuring one, and xterm
// measures a real canvas. jsdom has neither, so the addon cannot run and the
// question cannot be put to it.
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

// grep contract: asserts on source text, not behaviour.
// Stays one, and here is why. That activation fetches the tab's own namespace is
// checked by driving the hook. What is left is an absence - that activation does
// not reach for the namespace selector or the row list - and a function that is
// never called leaves no trace to assert on. The hook is not even handed those
// setters, which is the real guarantee; this keeps watch on it being handed them
// again.
test("activation is not given the namespace selector to move", () => {
  const workspaceTabsHook = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceWorkspaceTabs.ts"), "utf8");
  const activation = workspaceTabsHook.slice(workspaceTabsHook.indexOf("const activateResourceTab"), workspaceTabsHook.indexOf("function closeResourceTab"));
  assert.doesNotMatch(activation, /setNamespaceSelection\(/);
  assert.doesNotMatch(activation, /setRows\(/);
});

// grep contract: asserts on source text, not behaviour.
// Stays one, and here is why. It is a single grid-row declaration, and jsdom
// places nothing on a grid.
test("transient resource drawer occupies the workspace content row without saved tabs", () => {
  const styles = fs.readFileSync(path.join(rendererRoot, "styles/drawer.css"), "utf8");
  assert.match(styles, /\.resource-workspace\s*>\s*\.drawer\s*\{[^}]*grid-row:\s*2;/s);
});
