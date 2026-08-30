// Renderer controllers that do not belong to one of the domain files beside
// this one: the cluster rail and controller, manifest compare, Secret reveal,
// Pod Terminal, async action feedback, navigation and the small shared
// surfaces. The LLM tab moved to llm-tab-dom.contract.test.cjs, where its
// promises are checked by clicking rather than by reading its source.
// A test marked `grep contract` reads a source file and asserts on its text.
// It breaks on a rename and passes through a real regression, so it is a
// placeholder for a behavioural test rather than one. See section C of
// docs/file-structure-refactor-plan.md.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createTestScheduler, loadTypeScript, rendererRoot } = require("./helpers/renderer.cjs");

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

// grep contract: asserts on source text, not behaviour.
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

// grep contract: asserts on source text, not behaviour.
// Stays one, and here is why. What the Secret tab *does* - reveal a value only
// when asked, open a text value for editing at once, refuse to edit binary or
// immutable ones, confirm in a dialog that never shows the decoded value, hide
// on a timer and take an open confirmation down with it - is checked by
// revealing and clicking in secret-tab-dom.contract.test.cjs. What is left is
// the colour of the field the value is typed into, and jsdom has no cascade:
// nothing it reports would tell whether the caret is visible against the
// background. Section B of docs/unseen-defects-plan.md is where that kind of
// question gets an answer with arithmetic behind it.
test("the Secret editing field is themed rather than left to the browser", () => {
  const styles = fs.readFileSync(path.join(rendererRoot, "styles/modals.css"), "utf8");
  assert.match(styles, /\.secret-edit textarea\s*\{[^}]*background:\s*var\(--code-bg\);[^}]*color:\s*var\(--text\);[^}]*caret-color:\s*var\(--focus-ring\);/s);
});

// grep contract: asserts on source text, not behaviour.
// Stays one, and here is why. What the rail *does* - one button per cluster,
// exactly one marked current, one click to switch, arrows that walk and wrap, a
// context menu that offers only the action that applies and cannot be left
// stranded - is checked by clicking in cluster-rail-dom.contract.test.cjs. What
// is left has no behaviour to reach for. That a deleted component has not come
// back is the absence of a file. Where the rail sits in App.tsx would mean
// mounting the entire application to find out, which is a different kind of test
// from these. And the shell's grid needs a cascade jsdom does not have.
test("the cluster dropdown has not come back, and the rail is where it replaced it", () => {
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  const layout = fs.readFileSync(path.join(rendererRoot, "styles/layout.css"), "utf8");
  const topbar = fs.readFileSync(path.join(rendererRoot, "components/AppTopbar.tsx"), "utf8");

  assert.equal(fs.existsSync(path.join(rendererRoot, "components/ClusterSelector.tsx")), false);
  assert.doesNotMatch(app, /ClusterSelector/);
  assert.doesNotMatch(topbar, /<select/);
  assert.match(app, /<ClusterRail/);
  // The rail sits left of the resource navigation and keeps the drawer guard.
  assert.ok(app.indexOf("<ClusterRail") < app.indexOf("<AppSidebar"));
  assert.match(app, /onSelect=\{\(cluster\) => \{[\s\S]*?confirmDrawerNavigation\(\)[\s\S]*?openCluster\(cluster\)/);
  assert.match(layout, /\.app-shell\s*\{[^}]*grid-template-columns:\s*var\(--cluster-rail-width[^}]*\}/s);
  assert.match(layout, /\.cluster-rail-item\.is-active/);
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

// grep contract: asserts on source text, not behaviour.
test("Pod Terminal delegates paste to the single xterm input path", () => {
  const source = fs.readFileSync(path.join(rendererRoot, "components/TerminalTab.tsx"), "utf8");
  const keyboardHandler = source.slice(source.indexOf("terminal.attachCustomKeyEventHandler"), source.indexOf("terminal.onSelectionChange"));

  assert.match(source, /terminal\.onData\(\(data\) => \{\s*sendTerminalInput\(socketRef\.current, data\);/s);
  assert.doesNotMatch(keyboardHandler, /paste|readText|sendTerminalInput/);
  assert.doesNotMatch(source, /addEventListener\("paste"/);
  assert.doesNotMatch(source, /navigator\.clipboard\?\.readText/);
});

// grep contract: asserts on source text, not behaviour.
// Stays one, and here is why. What the themed select *does* - open a listbox,
// close on Escape, on Tab, on a press outside, report a choice once - is checked
// by clicking in themed-select-dom.contract.test.cjs. What is left is which
// control the terminal reaches for, and TerminalTab cannot be mounted to find
// out: it starts xterm, which needs measurement and a canvas that jsdom does not
// have. Until that changes, reading the source is the only way to see that a
// native <select> has not crept back in.
test("Pod Terminal reaches for the themed select rather than a native one", () => {
  const terminal = fs.readFileSync(path.join(rendererRoot, "components/TerminalTab.tsx"), "utf8");
  assert.doesNotMatch(terminal, /<select/);
  assert.match(terminal, /<ThemedSelect\s+ariaLabel="Container"/);
  assert.match(terminal, /<ThemedSelect\s+ariaLabel="Shell"/);
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

// grep contract: asserts on source text, not behaviour.
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

// grep contract: asserts on source text, not behaviour.
// Stays one, and here is why. What the hook *does* - open from the trigger,
// close on Escape, on a press outside, and pointedly not on a press on the
// trigger itself - is checked by clicking in
// anchored-popover-dom.contract.test.cjs, through a real consumer. What is left
// is an absence: that no component has grown its own second copy of the same
// effect, which is what the hook was extracted to end. An absence of duplicated
// code is a property of the source and has no behaviour to observe - a component
// with two working copies of the logic behaves exactly like one with a single
// one.
test("no popover surface carries its own copy of the hook's effect", () => {
  const menu = fs.readFileSync(path.join(rendererRoot, "components/ResourceTableColumnsMenu.tsx"), "utf8");
  const cell = fs.readFileSync(path.join(rendererRoot, "components/NodeLabelsCell.tsx"), "utf8");

  for (const component of [menu, cell]) {
    assert.match(component, /useAnchoredPopover\(POPOVER_WIDTH, POPOVER_HEIGHT\)/);
    assert.doesNotMatch(component, /window\.addEventListener\("pointerdown"/);
    assert.doesNotMatch(component, /placeAnchoredPopover\(/);
  }
  // Both cells of the labels column and the annotations column use it.
  assert.equal((cell.match(/useAnchoredPopover\(/g) ?? []).length, 2);
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

test("no source file carries text that was decoded through the wrong codepage", () => {
  // The command palette shipped "CRD Р’В· apps" from 2.20 to 2.22. A middle dot
  // (C2 B7) had been read as CP1251 twice on its way out of App.tsx, and each
  // pass turned one character into two more. Nothing failed: the file is valid
  // UTF-8, the types are strings either way, and no test read the subtitle. It
  // was only ever visible to someone opening the palette.
  //
  // These sequences are what UTF-8 punctuation looks like after being read as
  // CP1251 or Latin-1. None of them occurs in text anyone would write, so their
  // absence is worth asserting over the whole tree rather than one file.
  const mojibake = ["Р’", "РІ", "Ð", "â€", "Â", "Ã"];
  const sourceRoot = path.resolve(__dirname, "../src");

  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|json|css|html)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, "utf8");
      for (const sequence of mojibake) {
        if (text.includes(sequence)) offenders.push(`${path.relative(sourceRoot, full)}: ${sequence}`);
      }
    }
  };
  walk(sourceRoot);

  assert.deepEqual(offenders, []);
});

test("hovering a related resource does not hide what the card says", () => {
  const { readThemes, channels, contrast, over, readabilityFailures } = require("./helpers/contrast.cjs");
  const relatedCss = fs.readFileSync(path.join(rendererRoot, "styles/related-panel.css"), "utf8");
  const layoutCss = fs.readFileSync(path.join(rendererRoot, "styles/layout.css"), "utf8");

  // The polished card overrides the plain one's hover with !important, so the
  // token and the alpha are read from the rule that actually wins.
  const hover = relatedCss.match(/\.related-card-polished:hover \{\s*background: color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%, transparent\) !important;/);
  assert.ok(hover, "the polished hover must stay a color-mix of a theme token");
  const [, token, percent] = hover;
  const alpha = Number(percent) / 100;

  // A card is a name, a subtitle and a body, on the card's own background.
  assert.match(layoutCss, /\.related-card \{[^}]*background: var\(--panel-muted\);/s);
  const inkTokens = { name: "--text", subtitle: "--muted", body: "--muted-strong" };

  for (const [name, theme] of readThemes()) {
    const card = channels(theme["--panel-muted"]);
    const painted = over(channels(theme[token]), card, alpha);
    const inks = Object.fromEntries(Object.entries(inkTokens).map(([label, ink]) => [label, channels(theme[ink])]));

    const failures = readabilityFailures({ background: card, over: painted, inks });
    assert.deepEqual(failures, [], `${name}: hovering a related card ${failures.join("; ")}`);

    // A hover nobody can see is not a hover.
    const visible = contrast(painted, card);
    assert.ok(visible >= 1.2, `${name}: the hover is invisible against the card (${visible.toFixed(2)}:1)`);
  }
});
