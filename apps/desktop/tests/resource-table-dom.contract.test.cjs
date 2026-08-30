// The resource table, rendered and clicked on.
//
// These replace grep contracts: what a row does when it is clicked, what
// happens to a selection when the rows are replaced by a refresh, and what the
// filter and the empty state do. Every one of them used to be a regular
// expression over ResourceTable.tsx, or nothing at all.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React, window } = require("./helpers/dom.cjs");

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

test("the log stream URL carries what the tab is showing, and the session token", () => {
  const { ApiClient } = loadComponent("api.ts");
  const api = new ApiClient("http://127.0.0.1:7788", "session-token");

  const url = new URL(api.podLogsStreamUrl("cluster-1", "tools", "api-server", { container: "app", tail: 200, timestamps: true }));
  assert.equal(url.protocol, "ws:", "the stream is a WebSocket, not a poll");
  assert.equal(url.pathname, "/clusters/cluster-1/pods/tools/api-server/logs/stream");
  assert.equal(url.searchParams.get("container"), "app");
  assert.equal(url.searchParams.get("tail"), "200");
  assert.equal(url.searchParams.get("timestamps"), "true");
  assert.equal(url.searchParams.get("previous"), null, "what was not asked for is not sent");
  assert.equal(url.searchParams.get("token"), "session-token");

  // The batches the stream sends are what the tab appends.
  assert.deepEqual(api.parsePodLogsStreamMessage('{"type":"lines","lines":["a","b"]}'), { type: "lines", lines: ["a", "b"] });
  assert.equal(api.parsePodLogsStreamMessage("not json"), null);
  assert.equal(api.parsePodLogsStreamMessage('{"lines":[]}'), null, "a message without a type is not one");
});

test("a page far past the threshold keeps only the rows near the viewport in the DOM", async () => {
  const { window } = require("./helpers/dom.cjs");
  const many = Array.from({ length: 1000 }, (_, index) => pod(`pod-${String(index).padStart(4, "0")}`));
  const view = mount(table({ rows: many, stateKey: "pods-virtual" }));

  try {
    const scroll = view.first(".table-scroll");
    // jsdom has no layout, so the table is told how tall it and its rows are -
    // which is exactly what the component measures at runtime.
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 560 });
    let scrollTop = 0;
    Object.defineProperty(scroll, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = value;
      },
    });
    window.HTMLTableRowElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return { height: this.className === "virtual-spacer" ? Number(this.style.height.replace("px", "")) || 0 : 28, width: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} };
    };

    const settle = async () => {
      await React.act(async () => {
        scroll.dispatchEvent(new window.Event("scroll", { bubbles: false }));
        await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
      });
    };

    // The default page is 200 rows and renders whole; virtualization is for
    // the page sizes somebody chose on purpose.
    const pageSize = view.first(".table-footer select");
    React.act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
      setter.call(pageSize, "1000");
      pageSize.dispatchEvent(new window.Event("change", { bubbles: true }));
    });

    await settle();
    const rendered = () => view.all("tbody tr:not(.virtual-spacer)");
    const spacers = () => view.all("tbody tr.virtual-spacer");

    assert.ok(rendered().length > 0 && rendered().length < 100, `expected a window of rows, rendered ${rendered().length} of 1000`);
    assert.equal(view.rowNames()[0], "pod-0000", "the top of the page is where it starts");
    // The rows that are not rendered are still accounted for, so the scrollbar
    // and the page size mean the same thing they always did.
    const heights = spacers().map((row) => Number(row.style.height.replace("px", "")));
    assert.equal(heights.reduce((sum, value) => sum + value, 0) + rendered().length * 28, 1000 * 28, "the spacers hold exactly the height of the rows that are not rendered");

    // Scrolled into the middle, the window follows the viewport.
    scroll.scrollTop = 28 * 500;
    await settle();
    const names = view.all("tbody tr:not(.virtual-spacer)").map((row) => row.querySelectorAll("td")[1].textContent.trim());
    assert.ok(names[0] > "pod-0400" && names[0] < "pod-0500", `expected the window to follow the scroll, got ${names[0]}`);
    assert.ok(names.includes("pod-0500"));
  } finally {
    view.unmount();
  }
});

test("the default page is 200 rows, and 2000 is on offer without being the default", () => {
  // Replaces a grep contract that read PAGE_SIZE_OPTIONS and DEFAULT_PAGE_SIZE
  // out of the hook as text. A constant with the right value is not the same as
  // a table that shows that many rows: the slice that applies it is a separate
  // line, and reading both still would not say they agree.
  const rows = Array.from({ length: 300 }, (_, index) => pod(`pod-${String(index).padStart(3, "0")}`));
  const view = mount(table({ rows }));
  try {
    assert.equal(view.rows().length, 200, "the default page is 200 rows of 300");
    assert.match(view.text(".table-footer"), /^Rows 1-200 of 300/);

    const sizes = [...view.first(".table-footer select").querySelectorAll("option")].map((option) => Number(option.value));
    assert.deepEqual(sizes, [50, 100, 200, 500, 1000, 2000]);
    assert.equal(Number(view.first(".table-footer select").value), 200, "2000 is on offer, not in force");

    // Choosing a bigger page shows more of the same rows rather than more pages.
    const select = view.first(".table-footer select");
    React.act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(select, "500");
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    assert.equal(view.rows().length, 300, "a page larger than the list shows all of it");
    assert.match(view.text(".table-footer"), /^Rows 1-300 of 300/);
  } finally {
    view.unmount();
  }
});
