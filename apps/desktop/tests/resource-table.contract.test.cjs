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
test("resource table selection pruning and derived row lists avoid O(n^2) and re-render churn", () => {
  const state = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceTableState.ts"), "utf8");
  assert.doesNotMatch(state, /\.filter\(\(key\) => new Set\(rows\.map\(rowKey\)\)\.has\(key\)\)/, "rows.map(rowKey) must not be rebuilt inside the per-key filter callback");
  assert.match(state, /const rowKeys = new Set\(rows\.map\(rowKey\)\);/);
  assert.match(state, /setSelected\(\(current\) => new Set\(Array\.from\(current\)\.filter\(\(key\) => rowKeys\.has\(key\)\)\)\);/);
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
