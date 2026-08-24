// The boot screen: what it shows while KubeDeck starts, how its bar is allowed
// to move, and how it hands the window over to the application.
//
// `public/boot-screen.js` runs before the renderer bundle, so it cannot be
// imported the way a renderer module is. It is executed here against a minimal
// DOM instead, which is also what keeps its DOM usage small.
// A test marked `grep contract` reads a source file and asserts on its text.
// It breaks on a rename and passes through a real regression, so it is a
// placeholder for a behavioural test rather than one. See section C of
// docs/file-structure-refactor-plan.md.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTypeScript, rendererRoot } = require("./helpers/renderer.cjs");

const bootScreenSource = fs.readFileSync(path.join(rendererRoot, "public/boot-screen.js"), "utf8");
const mainProcess = fs.readFileSync(path.resolve(__dirname, "../src/main/main.ts"), "utf8");

function createElement(tag, registry) {
  const node = {
    tagName: tag,
    className: "",
    textContent: "",
    innerHTML: "",
    style: {},
    dataset: {},
    attributes: {},
    listeners: {},
    children: [],
    removed: false,
    append(...children) {
      node.children.push(...children);
    },
    setAttribute(name, value) {
      node.attributes[name] = value;
    },
    addEventListener(type, handler) {
      node.listeners[type] = handler;
    },
    remove() {
      node.removed = true;
    },
  };
  registry.push(node);
  return node;
}

// Runs boot-screen.js with a fake document, storage and clock. The script reads
// its globals as free identifiers, so they can be handed in as parameters.
function startBootScreen({ storage = {}, language = "en-US" } = {}) {
  const registry = [];
  const screen = createElement("div", registry);
  const head = createElement("head", registry);
  const document = {
    head,
    createElement: (tag) => createElement(tag, registry),
    getElementById: (id) => (id === "boot-screen" ? screen : null),
  };
  const localStorage = {
    getItem: (key) => (key in storage ? storage[key] : null),
    setItem: (key, value) => {
      storage[key] = value;
    },
  };

  let now = 1_000_000;
  const realNow = Date.now;
  Date.now = () => now;
  const timers = new Map();
  let timerId = 0;
  let frameCallback = null;

  const window = {};
  const environment = {
    window,
    screen,
    storage,
    node: (className) => registry.find((entry) => entry.className === className) ?? null,
    stage: (id) => registry.find((entry) => entry.dataset.stage === id) ?? null,
    percent: () => Number.parseInt(registry.find((entry) => entry.className === "boot-percent").textContent, 10),
    eta: () => registry.find((entry) => entry.className === "boot-eta").textContent,
    paint: () => {
      const callback = frameCallback;
      frameCallback = null;
      if (callback) callback();
    },
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers.entries()].sort((left, right) => left[1].at - right[1].at)) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.callback();
      }
      environment.paint();
    },
    restore: () => {
      Date.now = realNow;
    },
  };

  const run = new Function("window", "document", "localStorage", "navigator", "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", bootScreenSource);
  run(
    window,
    document,
    localStorage,
    { language },
    (callback) => {
      frameCallback = callback;
      return 1;
    },
    () => {
      frameCallback = null;
    },
    (callback, delay) => {
      timerId += 1;
      timers.set(timerId, { callback, at: now + delay });
      return timerId;
    },
    (id) => timers.delete(id),
  );

  return { ...environment, boot: window.__kubedeckBoot };
}

function completeStart(boot, environment, { clusterMs = 400 } = {}) {
  environment.advance(1200);
  boot.complete("ui");
  boot.begin("gateway");
  boot.begin("config");
  boot.begin("kubectl");
  boot.begin("cluster");
  environment.advance(100);
  boot.complete("gateway");
  boot.complete("config");
  boot.complete("kubectl");
  environment.advance(clusterMs - 100);
  boot.complete("cluster");
}

test("the boot screen is on screen before the bundle, already waiting on it", () => {
  const environment = startBootScreen();
  try {
    // Nothing has called into it yet: the interface stage is the bundle that
    // will eventually run and report the rest.
    assert.equal(environment.stage("ui").dataset.state, "active");
    assert.equal(environment.stage("gateway").dataset.state, "pending");
    assert.equal(environment.screen.dataset.done, "false");
    assert.equal(environment.node("boot-title").textContent, "Starting KubeDeck");
    assert.equal(environment.stage("config").children.at(-1).textContent, "config.json");
    assert.equal(environment.percent(), 0);
    // Without a previous start there is nothing honest to estimate from.
    environment.paint();
    assert.equal(environment.eta(), "");
  } finally {
    environment.restore();
  }
});

test("the bar follows the work, not the clock, and hands over when the work is done", () => {
  const environment = startBootScreen();
  const { boot } = environment;
  try {
    boot.complete("ui");
    environment.paint();
    assert.equal(environment.percent(), 42);

    boot.begin("gateway");
    environment.advance(200);
    const creeping = environment.percent();
    assert.ok(creeping > 42 && creeping < 55, `bar crept past its stage: ${creeping}%`);

    boot.complete("gateway");
    boot.begin("config");
    boot.complete("config");
    boot.begin("kubectl");
    boot.complete("kubectl");
    environment.paint();
    assert.equal(environment.percent(), 75);

    boot.begin("cluster", "prod-eu");
    assert.equal(environment.stage("cluster").children.at(-1).textContent, "prod-eu");
    assert.equal(environment.screen.removed, false);

    boot.complete("cluster");
    assert.equal(environment.percent(), 100);
    assert.equal(environment.screen.dataset.done, "true");
    environment.advance(300);
    assert.equal(environment.screen.removed, true);
  } finally {
    environment.restore();
  }
});

test("a start is measured so the next one can say how long is left", () => {
  const storage = {};
  const first = startBootScreen({ storage });
  try {
    completeStart(first.boot, first, { clusterMs: 4000 });
  } finally {
    first.restore();
  }
  const measured = JSON.parse(storage["kubedeck.boot.timings.v1"]);
  assert.equal(measured.version, 1);
  assert.equal(measured.stages.cluster, 4000);
  assert.equal(measured.stages.gateway, 100);

  const second = startBootScreen({ storage });
  try {
    // The cluster took forty times longer than the gateway last time, so it now
    // owns most of the bar instead of a fixed quarter of it.
    second.boot.complete("ui");
    second.paint();
    const afterInterface = second.percent();
    assert.ok(afterInterface > 12 && afterInterface < 25, `stale weights: ${afterInterface}%`);
    assert.match(second.eta(), /^about \d+ s left$/);
  } finally {
    second.restore();
  }
});

test("a stage that fails is named, and the screen still gets out of the way", () => {
  const storage = {};
  const environment = startBootScreen({ storage });
  const { boot } = environment;
  try {
    boot.complete("ui");
    boot.begin("gateway");
    boot.fail("gateway", "connection refused");
    assert.equal(environment.stage("gateway").dataset.state, "failed");
    assert.equal(environment.stage("gateway").children.at(-1).textContent, "connection refused");
    assert.equal(environment.screen.dataset.done, "false");
    // The application shows the real error; this only has to stop covering it.
    environment.advance(1200);
    assert.equal(environment.screen.dataset.done, "true");
    // A failed start is not a measurement of anything.
    assert.equal("kubedeck.boot.timings.v1" in storage, false);
  } finally {
    environment.restore();
  }
});

test("a start that will not finish can be dismissed, and gives up on its own", () => {
  const dismissed = startBootScreen();
  try {
    dismissed.boot.complete("ui");
    dismissed.boot.begin("cluster");
    assert.equal(dismissed.node("boot-skip").dataset.visible, "false");
    dismissed.advance(3000);
    assert.equal(dismissed.node("boot-skip").dataset.visible, "true");
    dismissed.node("boot-skip").listeners.click();
    assert.equal(dismissed.screen.dataset.done, "true");
  } finally {
    dismissed.restore();
  }

  const abandoned = startBootScreen();
  try {
    abandoned.boot.complete("ui");
    abandoned.boot.begin("cluster");
    abandoned.advance(19_000);
    assert.equal(abandoned.screen.dataset.done, "false");
    // An unreachable cluster must not hold the window: the interface is up and
    // can show its own connection state.
    abandoned.advance(1500);
    assert.equal(abandoned.screen.dataset.done, "true");
  } finally {
    abandoned.restore();
  }
});

test("the renderer wrapper forwards stages and is silent without a boot screen", () => {
  const calls = [];
  const previous = global.window;
  global.window = {
    __kubedeckBoot: {
      version: 1,
      begin: (stage, detail) => calls.push(["begin", stage, detail]),
      complete: (stage) => calls.push(["complete", stage]),
      fail: (stage, message) => calls.push(["fail", stage, message]),
      finish: () => calls.push(["finish"]),
      isFinished: () => false,
    },
  };
  try {
    const model = loadTypeScript("bootProgress.ts");
    model.beginBootStage("cluster", "prod-eu");
    model.completeBootStage("cluster");
    model.failBootStage("gateway", "connection refused");
    model.finishBoot();
    assert.deepEqual(calls, [["begin", "cluster", "prod-eu"], ["complete", "cluster"], ["fail", "gateway", "connection refused"], ["finish"]]);

    // Once the screen has handed over - and in the renderer tests, where there
    // is no screen at all - every call is a no-op rather than a crash.
    global.window.__kubedeckBoot.isFinished = () => true;
    model.beginBootStage("cluster");
    global.window = {};
    model.completeBootStage("cluster");
    model.finishBoot();
    assert.equal(calls.length, 4);
  } finally {
    global.window = previous;
  }
});

// grep contract: asserts on source text, not behaviour.
test("the boot screen is wired into the page and the stages it reports exist", () => {
  const html = fs.readFileSync(path.join(rendererRoot, "index.html"), "utf8");
  const entry = fs.readFileSync(path.join(rendererRoot, "main.tsx"), "utf8");
  const controller = fs.readFileSync(path.join(rendererRoot, "hooks/useClusterController.ts"), "utf8");
  const model = loadTypeScript("bootProgress.ts");

  assert.match(html, /<div id="boot-screen"><\/div>/);
  assert.match(html, /<script vite-ignore src="\.\/boot-screen\.js"><\/script>[\s\S]*<script type="module" src="\/main\.tsx">/);
  assert.match(entry, /completeBootStage\("ui"\)/);
  for (const stage of ["gateway", "config", "kubectl", "cluster"]) {
    assert.match(controller, new RegExp(`beginBootStage\\("${stage}"`), `useClusterController never begins ${stage}`);
    assert.match(controller, new RegExp(`completeBootStage\\("${stage}"\\)`), `useClusterController never completes ${stage}`);
  }
  assert.match(controller, /\.finally\(\(\) => \{\s*completeBootStage\("cluster"\);\s*finishBoot\(\);/);

  const declared = [...bootScreenSource.matchAll(/\{ id: "(\w+)", weight: ([\d.]+), expectedMs: \d+ \}/g)];
  assert.deepEqual(
    declared.map(([, id]) => id),
    [...model.BOOT_STAGES],
    "boot-screen.js and bootProgress.ts disagree about the stages",
  );
  const weight = declared.reduce((sum, [, , value]) => sum + Number(value), 0);
  assert.ok(Math.abs(weight - 1) < 1e-9, `default stage weights must fill the bar exactly, not ${weight}`);

  // The screen carries its own dictionary because i18n.ts ships in the bundle
  // it is waiting for. Both languages have to cover every stage.
  for (const language of ["en", "ru"]) {
    const dictionary = bootScreenSource.slice(bootScreenSource.indexOf(`${language}: {`));
    for (const stage of model.BOOT_STAGES) {
      assert.match(dictionary.slice(0, dictionary.indexOf("},\n    },")), new RegExp(`${stage}: \\[`), `${language} is missing the ${stage} stage`);
    }
  }
  // Same reason for the palette: tokens.css is in the bundle too.
  for (const theme of ["midnight", "graphite", "nord", "forest", "plum", "mocha", "light"]) {
    assert.match(bootScreenSource, new RegExp(`data-theme="${theme}"\\] \\{ --boot-bg:`), `boot screen has no ${theme} background`);
  }
});

// grep contract: asserts on source text, not behaviour.
test("the window opens while the gateway is still starting", () => {
  assert.match(mainProcess, /gatewayReady = startNodeGateway\(\);\s*await Promise\.all\(\[gatewayReady, createWindow\(\)\]\);/);
  // Opening the window first only works because the renderer's first call waits
  // for the address instead of being handed an empty one.
  assert.match(mainProcess, /ipcMain\.handle\("kubedeck:getBackendAuth", async \(\) => \{\s*if \(gatewayReady\) await gatewayReady;/);

  // The window paints its background, then the boot screen paints the same
  // colour over it. A theme missing from either list is a flash on startup.
  const windowBackgrounds = Object.fromEntries([...mainProcess.matchAll(/^ {2}(\w+): "(#[0-9a-f]{6})",$/gm)].map(([, theme, colour]) => [theme, colour]));
  const bootBackgrounds = Object.fromEntries([...bootScreenSource.matchAll(/data-theme="(\w+)"\] \{ --boot-bg: (#[0-9a-f]{6});/g)].map(([, theme, colour]) => [theme, colour]));
  assert.deepEqual(windowBackgrounds, bootBackgrounds);
  assert.match(mainProcess, /backgroundColor: windowBackgroundColor\(\),/);
});
