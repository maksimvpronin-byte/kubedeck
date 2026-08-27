// The resource table, rendered and clicked on.
//
// These replace grep contracts: what a row does when it is clicked, what
// happens to a selection when the rows are replaced by a refresh, and what the
// filter and the empty state do. Every one of them used to be a regular
// expression over ResourceTable.tsx, or nothing at all.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React } = require("./helpers/dom.cjs");

const { ResourceTable } = loadComponent("components/ResourceTable.tsx");

const COLUMNS = [
  { key: "name", label: "Name" },
  { key: "namespace", label: "Namespace" },
  { key: "phase", label: "Status" },
];

function pod(name, namespace = "default", phase = "Running") {
  return { uid: `uid-${namespace}-${name}`, name, namespace, phase };
}

// Sorted by the first column, so the table shows api-server, cache, worker.
const DEFAULT_ROWS = [pod("api-server"), pod("worker", "tools"), pod("cache", "tools", "Pending")];

let stateKeys = 0;

function table(props = {}) {
  stateKeys += 1;
  return React.createElement(ResourceTable, {
    title: "Pods",
    rows: DEFAULT_ROWS,
    columns: COLUMNS,
    loading: false,
    onRefresh: () => {},
    filterLabel: "Filter",
    refreshLabel: "Refresh",
    // A fresh key per test: column widths and hidden columns are persisted.
    stateKey: props.stateKey ?? `pods-${stateKeys}`,
    ...props,
  });
}

test("the table renders a row per resource, with the cells its columns name", () => {
  const view = mount(table());
  try {
    assert.deepEqual(view.rowNames(), ["api-server", "cache", "worker"]);
    const cells = [...view.rows()[0].querySelectorAll("td")].map((cell) => cell.textContent.trim());
    assert.deepEqual(cells.slice(1), ["api-server", "default", "Running"]);
    assert.match(view.text(".resource-table-header .muted"), /^3 shown of 3/);
  } finally {
    view.unmount();
  }
});

test("a click opens a row, a double click pins it, and the namespace pill does neither", () => {
  const opened = [];
  const pinned = [];
  const namespaces = [];
  const view = mount(
    table({
      onOpen: (row) => opened.push(row.name),
      onPin: (row) => pinned.push(row.name),
      onNamespaceClick: (namespace) => namespaces.push(namespace),
    }),
  );
  try {
    view.click(view.rows()[0]);
    assert.deepEqual(opened, ["api-server"]);

    view.doubleClick(view.rows()[2]);
    assert.deepEqual(pinned, ["worker"]);

    // The pill switches the namespace selection; opening the drawer as well
    // would take the user somewhere they did not ask to go.
    const openedBefore = opened.length;
    view.click(view.first("tbody tr .namespace-pill"));
    assert.deepEqual(namespaces, ["default"]);
    assert.equal(opened.length, openedBefore);
  } finally {
    view.unmount();
  }
});

test("selecting rows drives the bulk action, and the header checkbox takes the page", () => {
  const deleted = [];
  const view = mount(table({ onBulkDelete: (rows) => deleted.push(rows.map((row) => row.name)) }));
  try {
    view.toggle(view.all("tbody .select-col input")[0]);
    view.toggle(view.all("tbody .select-col input")[2]);
    assert.deepEqual(view.checkedRowNames(), ["api-server", "worker"]);

    const bulk = view.all(".danger-btn").find((button) => button.textContent.includes("Delete selected"));
    assert.ok(bulk, "the bulk delete button appears once something is selected");
    assert.match(bulk.textContent, /\(2\)/);
    view.click(bulk);
    // It hands over the rows themselves, in the order the table shows them.
    assert.deepEqual(deleted, [["api-server", "worker"]]);

    view.toggle(view.first("thead .select-col input"));
    assert.deepEqual(view.checkedRowNames(), ["api-server", "cache", "worker"], "the header checkbox selects the whole page");

    view.toggle(view.first("thead .select-col input"));
    assert.deepEqual(view.checkedRowNames(), [], "and clears it again");
    assert.equal(
      view.all(".danger-btn").some((button) => button.textContent.includes("Delete selected")),
      false,
      "with nothing selected the bulk action goes away",
    );
  } finally {
    view.unmount();
  }
});

test("a refresh keeps the selection, and drops only the rows that are gone", () => {
  const view = mount(table());
  try {
    view.toggle(view.all("tbody .select-col input")[0]);
    view.toggle(view.all("tbody .select-col input")[1]);
    assert.deepEqual(view.checkedRowNames(), ["api-server", "cache"]);

    // A refresh replaces every row object, as a list load does.
    view.update(table({ rows: DEFAULT_ROWS.map((row) => ({ ...row })), stateKey: "pods-refresh" }));
    assert.deepEqual(view.checkedRowNames(), ["api-server", "cache"], "the selection survives a refresh that changed nothing");

    // One selected row is deleted from the cluster, the other is not.
    view.update(table({ rows: [{ ...DEFAULT_ROWS[0] }, { ...DEFAULT_ROWS[1] }], stateKey: "pods-refresh" }));
    assert.deepEqual(view.checkedRowNames(), ["api-server"], "a row that is gone leaves the selection with it");
  } finally {
    view.unmount();
  }
});

test("the filter narrows the rows and the empty state offers to clear it", () => {
  const view = mount(table());
  try {
    view.type(view.first(".table-filter input"), "work");
    assert.deepEqual(view.rowNames(), ["worker"]);
    assert.match(view.text(".resource-table-header .muted"), /^1 shown of 3/);

    view.type(view.first(".table-filter input"), "nothing-matches-this");
    assert.equal(view.rows().length, 0);
    const empty = view.first(".empty-state");
    assert.ok(empty, "an empty result explains itself");
    assert.match(empty.textContent, /filter/i);

    view.click([...empty.querySelectorAll("button")].find((button) => button.textContent.includes("Clear filter")));
    assert.deepEqual(view.rowNames(), ["api-server", "cache", "worker"], "clearing the filter brings the rows back");
  } finally {
    view.unmount();
  }
});

test("the filter searches every column, not only the name", () => {
  const view = mount(table());
  try {
    view.type(view.first(".table-filter input"), "tools");
    assert.deepEqual(view.rowNames(), ["cache", "worker"]);

    view.type(view.first(".table-filter input"), "pending");
    assert.deepEqual(view.rowNames(), ["cache"], "and it is case-insensitive");
  } finally {
    view.unmount();
  }
});

test("a column header sorts, and clicking it again reverses", () => {
  const view = mount(table());
  try {
    assert.deepEqual(view.rowNames(), ["api-server", "cache", "worker"]);

    const nameHeader = view.all("thead th button.table-sort-button").find((button) => button.textContent.includes("Name"));
    view.click(nameHeader);
    assert.deepEqual(view.rowNames(), ["worker", "cache", "api-server"]);
    assert.equal(nameHeader.closest("th").getAttribute("aria-sort"), "descending");

    view.click(nameHeader);
    assert.deepEqual(view.rowNames(), ["api-server", "cache", "worker"]);
    assert.equal(nameHeader.closest("th").getAttribute("aria-sort"), "ascending");
  } finally {
    view.unmount();
  }
});

test("an empty list says so, and says something else once a filter is to blame", () => {
  const view = mount(table({ rows: [] }));
  try {
    assert.equal(view.rows().length, 0);
    const empty = view.first(".empty-state");
    assert.ok(empty);
    assert.doesNotMatch(empty.textContent, /Clear filter/, "there is no filter to clear");
  } finally {
    view.unmount();
  }
});
