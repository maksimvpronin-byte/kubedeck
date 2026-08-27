// The resource table: columns, sorting, pagination and memoization.
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

// grep contract: asserts on source text, not behaviour.
test("the columns popover leaves the table panel so a short table cannot clip it", () => {
  const menu = fs.readFileSync(path.join(rendererRoot, "components/ResourceTableColumnsMenu.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(rendererRoot, "styles/resource-table.css"), "utf8");

  // The panel is only as tall as its table - a cluster has a handful of nodes -
  // and it clips what overflows it. Its container-type makes it the containing
  // block for a fixed child too, so the popover has to leave its subtree.
  assert.match(styles, /\.resource-table-panel\s*\{[^}]*container-type:\s*inline-size;[^}]*overflow:\s*hidden;/s);
  assert.match(menu, /createPortal\(/);
  assert.match(menu, /document\.body,/);
  const placementSource = fs.readFileSync(path.join(rendererRoot, "utils/popoverPlacement.ts"), "utf8");
  assert.match(placementSource, /trigger\.getBoundingClientRect\(\)/);
  assert.match(styles, /\.table-columns-popover\s*\{[^}]*position:\s*fixed;/s);
  assert.doesNotMatch(styles, /\.table-columns-popover\s*\{[^}]*top:\s*calc\(100% \+ 6px\);/s);

  // Positioned from the trigger, the popover has to keep itself inside the
  // window rather than trusting the space below the button.
  assert.match(placementSource, /window\.innerHeight - bounds\.bottom/);
  assert.match(placementSource, /const upward = /);
  assert.match(placementSource, /window\.innerWidth - VIEWPORT_MARGIN - width/);
  const popoverHook = fs.readFileSync(path.join(rendererRoot, "hooks/useAnchoredPopover.ts"), "utf8");
  assert.match(menu, /useAnchoredPopover\(POPOVER_WIDTH, POPOVER_HEIGHT\)/);
  assert.match(popoverHook, /placeAnchoredPopover\(trigger, width, height\)/);
  assert.match(popoverHook, /window\.addEventListener\("resize", reposition\)/);
  assert.match(popoverHook, /window\.addEventListener\("scroll", reposition, true\)/);

  // A click inside the portal is outside the trigger's subtree, so the dismiss
  // handler has to know about both elements.
  assert.match(popoverHook, /triggerRef\.current\?\.contains\(target\) \|\| popoverRef\.current\?\.contains\(target\)/);

  // Out of the toolbar, the Reset button can no longer be styled through it.
  assert.match(styles, /\.table-columns-popover\s*\{[^}]*--kd-table-action-bg:/s);
  assert.doesNotMatch(styles, /\.resource-table-actions \.table-columns-popover-header/);
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
  assert.match(table, /metricsFor\(column\.key\)\.length \? \(/);
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

// grep contract: asserts on source text, not behaviour.
test("pod usage falls back from limit to request to the raw reading", () => {
  const usageCells = fs.readFileSync(path.join(rendererRoot, "components/resourceTable/UsageCells.tsx"), "utf8");
  const bar = fs.readFileSync(path.join(rendererRoot, "components/ResourceUsageBar.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(rendererRoot, "styles/resource-table.css"), "utf8");

  // The three tiers, in order.
  const cell = usageCells.slice(usageCells.indexOf("function PodUsageBar"));
  assert.ok(cell.indexOf('denominatorLabel="limit"') < cell.indexOf('denominatorLabel="request"'), "a limit must win over a request");
  assert.match(cell, /unavailableLabel=\{usedText \|\| "N\/A"\}/);
  assert.doesNotMatch(cell, /"No limit"/);

  // A request ratio may exceed 100%: the track clamps, the reading does not.
  assert.match(bar, /width: `\$\{Math\.min\(100, percent\)\}%`/);
  assert.match(bar, /<small>\{percent === null \? unavailableLabel : `\$\{percent\}%`\}<\/small>/);
  assert.match(bar, /const over = percent !== null && percent > 100;/);
  assert.match(styles, /\.resource-usage-bar\.is-soft\.is-over/);
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

// grep contract: asserts on source text, not behaviour.
test("the pagination bar sits at the bottom of the window, not under the last row", () => {
  const layout = fs.readFileSync(path.join(rendererRoot, "styles/layout.css"), "utf8");
  const styles = fs.readFileSync(path.join(rendererRoot, "styles/resource-table.css"), "utf8");
  const table = fs.readFileSync(path.join(rendererRoot, "components/ResourceTable.tsx"), "utf8");

  // The panel is the child `.main-panel-resource` actually has. The rules that
  // stretch it used to name `.table-surface`, an element no component renders
  // any more, so the panel was only as tall as its rows and the pagination bar
  // rode up under them with the window empty below.
  assert.doesNotMatch(layout, /\.main-panel-resource > \.table-surface/);
  assert.doesNotMatch(styles, /\.main-panel-resource > \.table-surface/);
  assert.match(layout, /\.main-panel-resource > \.resource-table-panel\s*\{[^}]*flex:\s*1 1 auto;/s);
  assert.match(styles, /\.main-panel-resource > \.resource-table-panel\s*\{[^}]*flex:\s*1 1 auto;/s);

  // The rows take what is left and the footer keeps its own height, which is
  // what puts it against the bottom edge.
  assert.match(styles, /\.table-scroll\s*\{[^}]*flex:\s*1 1 auto;[^}]*overflow:\s*auto;/s);
  assert.match(styles, /\.table-footer\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(table, /<div className="table-scroll">[\s\S]*<ResourceTablePagination/);

  // With no rows there is nothing to scroll: a header row holding the free
  // space would push the empty state down beside the pagination bar.
  assert.match(styles, /\.main-panel-resource > \.resource-table-panel:has\(> \.empty-state\) > \.table-scroll\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(styles, /\.main-panel-resource > \.resource-table-panel > \.empty-state\s*\{[^}]*flex:\s*1 1 auto;[^}]*justify-content:\s*center;/s);
  assert.match(styles, /\.main-panel-resource > \.resource-table-panel > \.empty-state > \*\s*\{[^}]*margin:\s*0;/s);
});

// grep contract: asserts on source text, not behaviour.
test("resource table keeps one sticky header inside its scroll container", () => {
  const table = fs.readFileSync(path.join(rendererRoot, "components/ResourceTable.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(rendererRoot, "styles/resource-table.css"), "utf8");
  assert.equal((table.match(/<table\b/g) ?? []).length, 1);
  assert.equal((table.match(/<colgroup>/g) ?? []).length, 1);
  assert.match(table, /<div className="table-scroll">[\s\S]*<thead>/);
  assert.match(styles, /\.resource-table th\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*z-index:\s*\d+;[^}]*background:\s*var\(--table-head\);/s);
});

// grep contract: asserts on source text, not behaviour.
test("resource table offers a 2000 row page without changing its default", () => {
  const state = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceTableState.ts"), "utf8");
  assert.match(state, /PAGE_SIZE_OPTIONS\s*=\s*\[50, 100, 200, 500, 1000, 2000\]/);
  assert.match(state, /DEFAULT_PAGE_SIZE\s*=\s*200/);
  assert.match(state, /visibleRows\.slice\(pageStart, pageStart \+ pageSize\)/);
});

// grep contract: asserts on source text, not behaviour.
test("selection pruning keeps its identity when it changes nothing", () => {
  const state = loadTypeScript("hooks/useResourceTableState.ts");
  const rows = [
    { uid: "a", name: "one", namespace: "default" },
    { uid: "b", name: "two", namespace: "default" },
  ];

  // Nothing selected is the usual case, and it must not hand React a new Set:
  // that was a second full render of the table on every refresh.
  const empty = new Set();
  assert.equal(state.pruneSelection(empty, rows), empty);

  // A selection that survives the refresh keeps its identity too.
  const intact = new Set(["a", "b"]);
  assert.equal(state.pruneSelection(intact, rows), intact);

  // Only a row that actually disappeared produces a new Set.
  const stale = new Set(["a", "gone"]);
  const pruned = state.pruneSelection(stale, rows);
  assert.notEqual(pruned, stale);
  assert.deepEqual([...pruned], ["a"]);
});

// grep contract: asserts on source text, not behaviour.
test("resource table derived row lists avoid O(n^2) and re-render churn", () => {
  const state = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceTableState.ts"), "utf8");
  assert.doesNotMatch(state, /\.filter\(\(key\) => new Set\(rows\.map\(rowKey\)\)\.has\(key\)\)/, "rows.map(rowKey) must not be rebuilt inside the per-key filter callback");
  assert.match(state, /setSelected\(\(current\) => pruneSelection\(current, rows\)\);/);
  assert.match(state, /const renderedRows = useMemo\(\(\) => visibleRows\.slice\(pageStart, pageStart \+ pageSize\), \[visibleRows, pageStart, pageSize\]\);/);
  assert.match(state, /const selectedRows = useMemo\(\(\) => visibleRows\.filter\(\(row\) => selected\.has\(rowKey\(row\)\)\), \[visibleRows, selected\]\);/);
  assert.match(state, /const selectedPageRows = useMemo\(\(\) => renderedRows\.filter\(\(row\) => selected\.has\(rowKey\(row\)\)\), \[renderedRows, selected\]\);/);
});

// grep contract: asserts on source text, not behaviour.
test("resource table columns, YAML match count, manifest diff and log filtering are memoized", () => {
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  assert.match(app, /const tableColumns = useMemo\(\(\) => buildResourceTableColumns\(t\), \[t\]\);/);

  const yamlTab = fs.readFileSync(path.join(rendererRoot, "components/YamlTab.tsx"), "utf8");
  assert.match(yamlTab, /const matches = useMemo\(\(\) => matchRanges\(yamlDraft, yamlQuery\), \[yamlDraft, yamlQuery\]\);/);
  const searchSource = fs.readFileSync(path.join(rendererRoot, "utils/searchMatches.ts"), "utf8");
  assert.match(searchSource, /const haystack = text\.toLowerCase\(\);/);
  assert.doesNotMatch(searchSource, /indexOf\(query\.toLowerCase\(\)/, "the needle and the haystack are lower-cased once, never inside the scan loop");

  const manifestCompare = fs.readFileSync(path.join(rendererRoot, "components/ManifestCompare.tsx"), "utf8");
  assert.match(manifestCompare, /const \{ left, right, rows, renderError \} = useMemo\(\(\) => \{/);
  assert.match(manifestCompare, /\}, \[currentYaml, targetYaml, raw, error\]\);/);

  const logsTab = fs.readFileSync(path.join(rendererRoot, "components/LogsTab.tsx"), "utf8");
  assert.match(logsTab, /const \{ lines, visibleLines, visibleText \} = useMemo\(\(\) => \{/);
  assert.match(logsTab, /\}, \[content, normalizedQuery\]\);/);
  // Scanning every visible line for occurrences is the same size of work as the
  // filter itself, so it is memoized on the same inputs rather than re-run per
  // render, and the per-line grouping the renderer reads hangs off it.
  assert.match(logsTab, /\[normalizedQuery, visibleLines\],/);
  assert.match(logsTab, /const matchesByLine = useMemo\([\s\S]*?\}, \[matches\]\);/);
});

// The cells' pure helpers moved into components/resourceTable/rowStatus.ts in
// section F, which made them reachable without a React tree. These replace
// grepping ResourceTable.tsx for the same rules.
const rowStatus = loadTypeScript("components/resourceTable/rowStatus.ts");

test("a row's health reason names the most specific problem it has", () => {
  const reason = (row) => rowStatus.rowHealthReason(row);

  // A finished pod is not unhealthy, whatever else the row carries.
  assert.equal(reason({ phase: "Succeeded", reason: "Completed" }), "");
  assert.equal(reason({ phase: "Completed", containerProblems: "app: Error" }), "");

  // Container problems are the most specific thing there is, so they win.
  assert.equal(reason({ phase: "Running", reason: "Unhealthy", containerProblems: "app: CrashLoopBackOff back-off" }), "app: CrashLoopBackOff back-off");
  assert.equal(reason({ phase: "Running", reason: "Unhealthy", statusMessage: "probe failed" }), "Unhealthy");
  assert.equal(reason({ phase: "Running", statusMessage: "probe failed" }), "probe failed");
  assert.equal(reason({ phase: "Running", conditions: "Ready=False" }), "Ready=False");

  // A phase that is not a healthy one speaks for itself.
  assert.equal(reason({ phase: "Pending" }), "Pending");
  assert.equal(reason({ phase: "Running", ready: "1/1" }), "", "a running, fully ready pod has nothing to report");
  assert.equal(reason({ phase: "Running", ready: "1/2" }), "Ready 1/2", "a running pod missing a container does");
  assert.equal(reason({}), "");
});

test("a health reason is trimmed to its first clause and to a readable length", () => {
  assert.equal(rowStatus.compactReason("first problem; second problem"), "first problem");
  const long = `${"x".repeat(100)}; ignored`;
  const compact = rowStatus.compactReason(long);
  assert.equal(compact.length, 72);
  assert.ok(compact.endsWith("..."));
});

test("container cubes are built from states when there are any, and from names otherwise", () => {
  const withStates = rowStatus.normalizeContainerStatusItems({
    containerStates: [
      { name: "app", state: "running", ready: true, restartCount: 0 },
      { name: "sidecar", state: "waiting", ready: false, reason: "ImagePullBackOff", restartCount: 3 },
    ],
  });
  assert.deepEqual(
    withStates.map((item) => item.tone),
    ["ready", "danger"],
  );
  assert.match(withStates[1].title, /sidecar/);
  assert.match(withStates[1].title, /ImagePullBackOff/);
  assert.match(withStates[1].title, /3 restarts/, "a restart count is worth saying, a zero is not");
  assert.doesNotMatch(withStates[0].title, /restarts/);

  // A row that only knows the container names still shows one cube each.
  const namesOnly = rowStatus.normalizeContainerStatusItems({ containers: ["app", "sidecar"] });
  assert.equal(namesOnly.length, 2);
  assert.deepEqual(
    namesOnly.map((item) => item.tone),
    ["unknown", "unknown"],
  );

  assert.deepEqual(rowStatus.normalizeContainerStatusItems({}), [], "a row with neither shows no cubes at all");
});

test("usage values are formatted at the unit a reader thinks in", () => {
  // The table prints Kubernetes notation here, not the display format: these
  // are the limit and request shown beside row.cpuUsage, which the backend
  // writes the same way. One bar cannot read "403840Ki used · 1.5 cores limit".
  assert.equal(rowStatus.formatCpuValue(2000), "2");
  assert.equal(rowStatus.formatCpuValue(1500), "1500m");
  assert.equal(rowStatus.formatCpuValue(250), "250m");
  assert.equal(rowStatus.formatCpuValue(0), "", "an unset limit prints nothing, not a zero");
  assert.equal(rowStatus.formatCpuValue(null), "");

  assert.equal(rowStatus.formatByteValue(1024 ** 3), "1Gi");
  assert.equal(rowStatus.formatByteValue(1024 ** 2 * 512), "512Mi");
  assert.equal(rowStatus.formatByteValue(2048), "2Ki");
  assert.equal(rowStatus.formatByteValue(512), "512B");
  assert.equal(rowStatus.formatByteValue(0), "");
});

test("a percentage against a request is rounded but not clamped", () => {
  assert.equal(rowStatus.unclampedPercent("42%"), 42);
  assert.equal(rowStatus.unclampedPercent(42.6), 43);
  // Using more than the request is the interesting case, and it must survive.
  assert.equal(rowStatus.unclampedPercent("240%"), 240);
  assert.equal(rowStatus.unclampedPercent(-5), 0);
  assert.equal(rowStatus.unclampedPercent("N/A"), null);
  assert.equal(rowStatus.unclampedPercent(undefined), null);
});

// One implementation behind every quantity the application prints. Eight copies
// with four different rounding rules became this in 2.20.7.
const quantity = loadTypeScript("../shared/formatQuantity.ts");

test("CPU is printed as cores above a core and as millicores below it", () => {
  assert.equal(quantity.formatCpuMillicores(2500), "2.5 cores");
  assert.equal(quantity.formatCpuMillicores(1000), "1 core");
  assert.equal(quantity.formatCpuMillicores(999), "999m");
  assert.equal(quantity.formatCpuMillicores(250.44), "250.4m", "millicores keep one decimal");
  assert.equal(quantity.formatCpuMillicores(2333), "2.33 cores", "cores keep two");
  assert.equal(quantity.formatCpuMillicores(null), "", "an absent value prints nothing by default");
  assert.equal(quantity.formatCpuMillicores("nonsense", { fallback: "unknown" }), "unknown");
});

test("bytes are printed in the largest unit that leaves a number above one", () => {
  assert.equal(quantity.formatBytes(1024 ** 4 * 2), "2 TiB");
  assert.equal(quantity.formatBytes(1024 ** 3), "1 GiB");
  assert.equal(quantity.formatBytes(1024 ** 2 * 512), "512 MiB");
  assert.equal(quantity.formatBytes(2048), "2 KiB");
  assert.equal(quantity.formatBytes(512), "512 B");
  assert.equal(quantity.formatBytes(33_690_845_184), "31.38 GiB");
  assert.equal(quantity.formatBytes(33_690_845_184, { digits: 1 }), "31.4 GiB");
  assert.equal(quantity.formatBytes(undefined, { fallback: "N/A" }), "N/A");
});

test("a column that must be compared down its length can pin the unit", () => {
  // Node capacity columns: 900 MiB and 30 GiB in the same column cannot be
  // compared at a glance, so both are printed in GiB.
  assert.equal(quantity.formatBytesIn(1024 ** 3 * 30, "GiB"), "30 GiB");
  assert.equal(quantity.formatBytesIn(1024 ** 2 * 900, "GiB"), "0.88 GiB");
  assert.equal(quantity.formatBytesIn(null, "GiB", { fallback: "N/A" }), "N/A");
});

test("thousands separators are off unless asked for, because some of these strings are parsed back", () => {
  // resources/metrics.ts formats node capacity into a row field that
  // ResourceSummary parses with a regex; a separator would not match it.
  assert.equal(quantity.formatCpuMillicores(1_024_000), "1024 cores");
  assert.match(quantity.formatCpuMillicores(1_024_000, { group: true }), /1\D024 cores/);
});

test("Kubernetes notation is a separate format, and it is the one a bar's own reading uses", () => {
  // `kubectl top` prints these, the sampler stores them, and the usage bar
  // shows a limit beside a reading that came from there.
  assert.equal(quantity.formatCpuNotation(2000), "2");
  assert.equal(quantity.formatCpuNotation(1500), "1500m");
  assert.equal(quantity.formatCpuNotation(0), "0m");
  assert.equal(quantity.formatCpuNotation(null, { fallback: "N/A" }), "N/A");

  assert.equal(quantity.formatMemoryNotation(1024 ** 3), "1Gi");
  assert.equal(quantity.formatMemoryNotation(1024 ** 2 * 512), "512Mi");
  // Magnitude picks the unit, not exact division: 403840Ki divides by 1024
  // evenly but a reader wants the Mi.
  assert.equal(quantity.formatMemoryNotation(413_532_160), "394.4Mi");
  assert.equal(quantity.formatMemoryNotation(0), "0Mi");
  assert.equal(quantity.formatMemoryNotation(null, { fallback: "N/A" }), "N/A");
});

// grep contract: asserts on source text, not behaviour.
test("a table row is skipped when nothing about it changed", () => {
  const tableRow = fs.readFileSync(path.join(rendererRoot, "components/resourceTable/ResourceTableRow.tsx"), "utf8");
  const table = fs.readFileSync(path.join(rendererRoot, "components/ResourceTable.tsx"), "utf8");

  // A page is 200 rows of a dozen cells by default; without this every one of
  // them was rebuilt for a column drag, a checkbox, or three pods whose usage
  // moved.
  assert.match(tableRow, /export const ResourceTableRow = memo\(Row\);/);

  // Memo is only worth anything if the props hold still. The table is handed
  // fresh arrows on every render of the application, so the row reads them
  // through a ref instead.
  assert.match(table, /const rowHandlers = useMemo<ResourceTableRowHandlers>\(/);
  assert.match(table, /\}\),\s*\[\],\s*\);/);
  assert.match(table, /callbacksRef\.current = \{ onOpen, onPin, onNamespaceClick, toggleRow, setQuery \};/);
  assert.match(table, /handlers=\{rowHandlers\}/);
});
