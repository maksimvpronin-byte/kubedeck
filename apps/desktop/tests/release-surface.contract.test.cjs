// Version-stamped surface contracts.
// Split out of renderer-controllers.contract.test.cjs; see
// docs/file-structure-refactor-plan.md, section C.
// Every test here is a release contract rather than a grep contract, and that
// is a decision rather than an omission - see section A of
// docs/unseen-defects-plan.md, 2026-08-29. What they hold are properties of a
// release: that the package carries no Python runtime and no bundled kubectl,
// that Help and About describe the application as it actually behaves, and that
// surfaces promised by earlier releases are still there. A property of a file
// has no behaviour to click, so these are marked `release contract` and are not
// counted against the grep-contract debt.
// A test marked `grep contract` reads a source file and asserts on its text.
// It breaks on a rename and passes through a real regression, so it is a
// placeholder for a behavioural test rather than one. See section C of
// docs/file-structure-refactor-plan.md.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTypeScript, rendererRoot } = require("./helpers/renderer.cjs");

// release contract: asserts on the shape of a release, which has no behaviour.
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
  const formatCell = fs.readFileSync(path.join(rendererRoot, "components/resourceTable/formatCell.tsx"), "utf8");
  assert.match(formatCell, /className=\{`phase-value is-\$\{kubernetesStatusTone\(row\)\}`\}/);
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

// release contract: asserts on the shape of a release, which has no behaviour.
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

test("2.7.6 resource surfaces align compare panes and render compact operational signals", () => {
  const compare = fs.readFileSync(path.join(rendererRoot, "components/ManifestCompare.tsx"), "utf8");
  const summary = fs.readFileSync(path.join(rendererRoot, "components/ResourceSummary.tsx"), "utf8");
  const lifecycle = fs.readFileSync(path.join(rendererRoot, "hooks/usePodDrawerResourceLifecycle.ts"), "utf8");
  assert.match(compare, /target\.scrollTop !== source\.scrollTop/);
  assert.match(compare, /target\.scrollLeft !== source\.scrollLeft/);
  assert.match(compare, /aria-label=\{side === "left" \? "Current manifest" : "Compared manifest"\}/);
  const usageCells = fs.readFileSync(path.join(rendererRoot, "components/resourceTable/UsageCells.tsx"), "utf8");
  const statusCells = fs.readFileSync(path.join(rendererRoot, "components/resourceTable/StatusCells.tsx"), "utf8");
  const formatCell = fs.readFileSync(path.join(rendererRoot, "components/resourceTable/formatCell.tsx"), "utf8");
  assert.match(usageCells, /<ResourceUsageBar label="CPU"/);
  assert.match(usageCells, /<ResourceUsageBar label="RAM"/);
  assert.match(statusCells, /workload-condition-list/);
  assert.match(formatCell, /nodeLabelItems/);
  assert.match(summary, /formatQuotaQuantity/);
  assert.match(lifecycle, /\.resourceMetrics\(/);
  assert.match(lifecycle, /metricsRequestRef/);
  const model = loadTypeScript("components/ResourceSummary.tsx");
  assert.equal(model.formatQuotaQuantity("requests.memory", "1024Ki"), "1 MiB");
  assert.equal(model.formatQuotaQuantity("requests.memory", "1536Mi"), "1.5 GiB");
  assert.equal(model.formatQuotaQuantity("limits.cpu", "200m"), "200m");
  assert.equal(model.formatQuotaQuantity("pods", "25"), "25");
});

// release contract: asserts on the shape of a release, which has no behaviour.
test("2.8.0 usage, local lazy boundaries, folding, and seamless tabs stay contracted", () => {
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  const yamlTab = fs.readFileSync(path.join(rendererRoot, "components/YamlTab.tsx"), "utf8");
  const drawerStyles = fs.readFileSync(path.join(rendererRoot, "styles/drawer.css"), "utf8");
  const terminalStyles = fs.readFileSync(path.join(rendererRoot, "styles/terminal.css"), "utf8");
  const tableColumns = fs.readFileSync(path.join(rendererRoot, "utils/resourceTableColumns.ts"), "utf8");
  const nodeDiskUsage = fs.readFileSync(path.join(rendererRoot, "hooks/useNodeDiskUsage.ts"), "utf8");
  assert.match(tableColumns, /key: "podResources", label: "Usage"/);
  assert.match(app, /onVisibleNodeRows=\{loadVisibleNodeDisk\}/);
  assert.match(nodeDiskUsage, /Promise\.all\(Array\.from\(\{ length: Math\.min\(NODE_DISK_CONCURRENCY, queue\.length\) \}, worker\)\)/);
  const usage = fs.readFileSync(path.join(rendererRoot, "components/resourceTable/UsageCells.tsx"), "utf8");
  assert.match(usage, /label="Storage"/);
  assert.match(usage, /label="Disk"/);
  assert.match(usage, /function PodResourceUsage/);
  const lazySurface = fs.readFileSync(path.join(rendererRoot, "components/LazySurface.tsx"), "utf8");
  assert.match(lazySurface, /export function LazySurface/);
  // The boundary is what mounts a lazy panel, so App itself never reaches for Suspense.
  assert.doesNotMatch(app, /<Suspense/);
  assert.match(yamlTab, /yamlFoldRegions/);
  assert.match(yamlTab, /Collapse top-level YAML groups/);
  assert.match(drawerStyles, /\.resource-workspace-tab\.active::after/);
  assert.match(terminalStyles, /\.bottom-terminal-tab\.active::after/);
});

// release contract: asserts on the shape of a release, which has no behaviour.
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
  const router = fs.readFileSync(path.join(rendererRoot, "components/AppSectionRouter.tsx"), "utf8");
  assert.match(router, /<OverviewPanel/);
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

// release contract: asserts on the shape of a release, which has no behaviour.
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

// release contract: asserts on the shape of a release, which has no behaviour.
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
