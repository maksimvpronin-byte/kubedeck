// The namespace selector and per-cluster namespace scope.
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
// Stays one, and here is why. A name is readable when the element is wide
// enough for it and does not clip - which is measurement, and jsdom gives every
// element a width of zero.
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

// grep contract: asserts on source text, not behaviour.
// Stays one, and here is why. The refresh itself - that a poll for another
// cluster publishes nothing, that a `_cluster` scope's hidden selection survives
// a background poll, that an empty answer never widens a chosen scope - is now
// driven in namespace-refresh-dom.contract.test.cjs. What is left belongs to
// useResourceNavigation, which decides whether opening a resource from Search or
// Related should narrow the scope at all; that runs inside the shell.
test("opening a resource keeps a scope that already covers it", () => {
  const navigation = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceNavigation.ts"), "utf8");
  assert.match(navigation, /const needsNarrowerScope = /);
  assert.match(navigation, /!activeSelection\.includes\("all"\) && !activeSelection\.includes\(target\.namespace\)/);
  assert.match(navigation, /if \(target\.clusterScoped \|\| lookupCoversSelection\) setRows\(/);
});
