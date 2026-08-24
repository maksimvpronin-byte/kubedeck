// The screen KubeDeck shows from the first paint until the application has
// actually started: the renderer bundle, the local gateway, the settings file,
// kubectl and the cluster that was open last.
//
// It is a plain script in `public/` on purpose. The longest stage it reports is
// the parsing of the renderer bundle itself, so it has to be on screen before
// that bundle runs - which also means it cannot import `styles/tokens.css` or
// `i18n.ts`. The handful of theme colours and the two-language dictionary are
// repeated here instead, and tests/boot-screen.contract.test.cjs keeps them in
// step with the sources they were copied from.
(() => {
  const TIMINGS_KEY = "kubedeck.boot.timings.v1";
  const LANGUAGE_KEY = "kubedeck.language";
  const SKIP_AFTER_MS = 3000;
  // A cluster that stopped answering must not hold the window hostage: once the
  // interface itself is up, the screen hands over on its own.
  const HANDOVER_AFTER_UI_MS = 20000;
  const FAILURE_HANDOVER_MS = 1200;
  const FADE_MS = 260;
  const MIN_STAGE_WEIGHT = 0.03;

  // Weights are how much of the bar a stage owns, expected durations are what
  // makes the bar move inside a stage. Both are replaced by the measurements of
  // the previous start as soon as there is one.
  const STAGES = [
    { id: "ui", weight: 0.42, expectedMs: 1200 },
    { id: "gateway", weight: 0.13, expectedMs: 320 },
    { id: "config", weight: 0.05, expectedMs: 120 },
    { id: "kubectl", weight: 0.15, expectedMs: 500 },
    { id: "cluster", weight: 0.25, expectedMs: 900 },
  ];

  const TEXT = {
    en: {
      title: "Starting KubeDeck",
      subtitle: "Preparing the workspace",
      skip: "Continue in background",
      failed: "failed",
      almost: "almost there",
      eta: (seconds) => `about ${seconds} s left`,
      stages: {
        ui: ["Interface", "bundle, styles, theme"],
        gateway: ["Local gateway", "127.0.0.1 · session token"],
        config: ["Settings", "config.json"],
        kubectl: ["kubectl", "client version"],
        cluster: ["Cluster", "kubeconfig · namespaces · API resources"],
      },
    },
    ru: {
      title: "Запуск KubeDeck",
      subtitle: "Готовим рабочее место",
      skip: "Продолжить в фоне",
      failed: "не удалось",
      almost: "почти готово",
      eta: (seconds) => `осталось около ${seconds} с`,
      stages: {
        ui: ["Интерфейс", "бандл, стили, тема"],
        gateway: ["Локальный шлюз", "127.0.0.1 · сессионный токен"],
        config: ["Настройки", "config.json"],
        kubectl: ["kubectl", "версия клиента"],
        cluster: ["Кластер", "kubeconfig · namespaces · API-ресурсы"],
      },
    },
  };

  const CSS = `
#boot-screen {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--boot-bg);
  color: var(--boot-text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  transition: opacity ${FADE_MS}ms ease;
}
#boot-screen[data-done="true"] { opacity: 0; pointer-events: none; }
.boot-card { display: flex; flex-direction: column; gap: 20px; width: min(440px, calc(100vw - 64px)); }
.boot-head { display: flex; align-items: center; gap: 14px; }
.boot-mark { flex: none; width: 38px; height: 38px; color: var(--boot-accent); }
.boot-title { font-size: 17px; font-weight: 600; letter-spacing: 0.2px; color: var(--boot-text); }
.boot-subtitle { margin-top: 3px; font-size: 12px; color: var(--boot-muted); }
.boot-track { height: 4px; border-radius: 999px; background: var(--boot-border); overflow: hidden; }
.boot-fill { width: 0%; height: 100%; border-radius: 999px; background: var(--boot-accent); transition: width 220ms ease; }
.boot-meta { display: flex; justify-content: space-between; gap: 12px; margin-top: -12px; font-size: 11px; color: var(--boot-muted); font-variant-numeric: tabular-nums; }
.boot-stages { display: flex; flex-direction: column; gap: 9px; margin: 0; padding: 0; list-style: none; }
.boot-stage { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--boot-muted); }
.boot-stage[data-state="active"] { color: var(--boot-text); }
.boot-stage[data-state="failed"] { color: var(--boot-danger); }
.boot-dot { flex: none; box-sizing: border-box; width: 11px; height: 11px; border: 1.5px solid var(--boot-border); border-radius: 50%; }
.boot-stage[data-state="active"] .boot-dot { border-color: var(--boot-accent); border-top-color: transparent; animation: boot-spin 700ms linear infinite; }
.boot-stage[data-state="done"] .boot-dot { border-color: var(--boot-accent); background: var(--boot-accent); }
.boot-stage[data-state="failed"] .boot-dot { border-color: var(--boot-danger); background: var(--boot-danger); }
.boot-detail { margin-left: auto; padding-left: 12px; font-size: 11px; text-align: right; color: var(--boot-muted); opacity: 0.85; }
.boot-skip { align-self: flex-start; padding: 5px 11px; border: 1px solid var(--boot-border); border-radius: 6px; background: transparent; color: var(--boot-muted); font: inherit; font-size: 11px; cursor: pointer; opacity: 0; pointer-events: none; transition: opacity 200ms ease; }
.boot-skip[data-visible="true"] { opacity: 1; pointer-events: auto; }
.boot-skip:hover { color: var(--boot-text); border-color: var(--boot-accent); }
@keyframes boot-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .boot-stage[data-state="active"] .boot-dot { animation: none; }
  #boot-screen, .boot-fill, .boot-skip { transition: none; }
}
:root, :root[data-theme="midnight"] { --boot-bg: #18212b; --boot-text: #e0e7ef; --boot-muted: #a3b2c4; --boot-border: #344455; --boot-accent: #4d94b7; --boot-danger: #f1b0b0; }
:root[data-theme="graphite"] { --boot-bg: #20252b; --boot-text: #dde3e8; --boot-muted: #aeb8c1; --boot-border: #3e4851; --boot-accent: #49a5cc; --boot-danger: #f1b0b0; }
:root[data-theme="nord"] { --boot-bg: #242b38; --boot-text: #e5e9f0; --boot-muted: #b4bfce; --boot-border: #465264; --boot-accent: #88c0d0; --boot-danger: #f1b0b0; }
:root[data-theme="forest"] { --boot-bg: #172623; --boot-text: #dce9e5; --boot-muted: #a6bbb5; --boot-border: #365149; --boot-accent: #5fb3a2; --boot-danger: #f1b0b0; }
:root[data-theme="plum"] { --boot-bg: #25212b; --boot-text: #e9e1ec; --boot-muted: #bcaec2; --boot-border: #504458; --boot-accent: #b194c7; --boot-danger: #f1b0b0; }
:root[data-theme="mocha"] { --boot-bg: #29231f; --boot-text: #ece2d8; --boot-muted: #c2b3a4; --boot-border: #574a40; --boot-accent: #d0a66e; --boot-danger: #f1b0b0; }
:root[data-theme="light"] { --boot-bg: #eef3f8; --boot-text: #172033; --boot-muted: #5f6f86; --boot-border: #d4dde8; --boot-accent: #2d84a8; --boot-danger: #b3261e; }
`;

  const MARK = `<svg viewBox="0 0 40 40" width="38" height="38" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
<path d="M20 3.6 33.5 11v18L20 36.4 6.5 29V11L20 3.6Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" opacity="0.55"/>
<path d="M20 12.4 27.8 17v9.2L20 30.8 12.2 26.2V17L20 12.4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
<circle cx="20" cy="21.6" r="2.6" fill="currentColor"/>
</svg>`;

  const root = document.getElementById("boot-screen");
  if (!root) return;

  function resolveLanguage() {
    let stored = "";
    try {
      stored = localStorage.getItem(LANGUAGE_KEY) || "";
    } catch {
      // Storage can be unavailable under restrictive browser policies.
    }
    if (stored === "ru" || stored === "en") return stored;
    const system = (navigator && navigator.language) || "";
    return system.toLowerCase().startsWith("ru") ? "ru" : "en";
  }

  function readTimings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TIMINGS_KEY) || "null");
      if (!parsed || parsed.version !== 1 || !parsed.stages) return null;
      for (const stage of STAGES) {
        const value = parsed.stages[stage.id];
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
      }
      return parsed.stages;
    } catch {
      return null;
    }
  }

  const text = TEXT[resolveLanguage()];
  const measured = readTimings();
  const stages = STAGES.map((stage) => ({
    id: stage.id,
    weight: stage.weight,
    expectedMs: measured ? Math.max(measured[stage.id], 60) : stage.expectedMs,
    state: "pending",
    startedAt: 0,
    durationMs: 0,
    timed: false,
    row: null,
    detail: null,
  }));

  // A start that spends four seconds on the cluster and 200ms everywhere else
  // should spend most of the bar on the cluster, or the bar lies about where
  // the wait is.
  if (measured) {
    const total = stages.reduce((sum, stage) => sum + stage.expectedMs, 0);
    const raw = stages.map((stage) => Math.max(MIN_STAGE_WEIGHT, stage.expectedMs / total));
    const rawTotal = raw.reduce((sum, value) => sum + value, 0);
    stages.forEach((stage, index) => {
      stage.weight = raw[index] / rawTotal;
    });
  }

  function element(tag, className) {
    const node = document.createElement(tag);
    node.className = className;
    return node;
  }

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);

  const card = element("div", "boot-card");
  const head = element("div", "boot-head");
  const mark = element("div", "boot-mark");
  mark.innerHTML = MARK;
  const heading = element("div", "boot-heading");
  const title = element("div", "boot-title");
  title.textContent = text.title;
  const subtitle = element("div", "boot-subtitle");
  subtitle.textContent = text.subtitle;
  heading.append(title, subtitle);
  head.append(mark, heading);

  const track = element("div", "boot-track");
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  const fill = element("div", "boot-fill");
  track.append(fill);

  const meta = element("div", "boot-meta");
  const percent = element("span", "boot-percent");
  percent.textContent = "0%";
  const eta = element("span", "boot-eta");
  meta.append(percent, eta);

  const list = element("ul", "boot-stages");
  for (const stage of stages) {
    const [label, detail] = text.stages[stage.id];
    const row = element("li", "boot-stage");
    row.dataset.state = "pending";
    row.dataset.stage = stage.id;
    const dot = element("span", "boot-dot");
    const name = element("span", "boot-label");
    name.textContent = label;
    const hint = element("span", "boot-detail");
    hint.textContent = detail;
    row.append(dot, name, hint);
    stage.row = row;
    stage.detail = hint;
    list.append(row);
  }

  const skip = element("button", "boot-skip");
  skip.setAttribute("type", "button");
  skip.dataset.visible = "false";
  skip.textContent = text.skip;
  skip.addEventListener("click", () => finish());

  card.append(head, track, meta, list, skip);
  root.dataset.done = "false";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.append(card);

  let shown = 0;
  let frame = 0;
  let finished = false;
  let failed = false;
  let handover = 0;

  const skipTimer = setTimeout(() => {
    if (!finished) skip.dataset.visible = "true";
  }, SKIP_AFTER_MS);

  function stageById(id) {
    return stages.find((stage) => stage.id === id) || null;
  }

  function elapsed(stage) {
    return stage.startedAt ? Date.now() - stage.startedAt : 0;
  }

  function progress() {
    let value = 0;
    for (const stage of stages) {
      if (stage.state === "done") {
        value += stage.weight;
        continue;
      }
      if (stage.state !== "active") continue;
      // Capped below the stage boundary: a stage is finished when the work
      // behind it says so, never because it took as long as it did last time.
      value += stage.weight * Math.min(0.92, elapsed(stage) / Math.max(stage.expectedMs, 250));
    }
    return Math.min(1, value);
  }

  function remainingSeconds() {
    let remaining = 0;
    for (const stage of stages) {
      if (stage.state === "done") continue;
      remaining += Math.max(0, stage.expectedMs - elapsed(stage));
    }
    return Math.ceil(remaining / 1000);
  }

  function paint() {
    shown = Math.max(shown, progress());
    const value = Math.round(shown * 100);
    fill.style.width = `${value}%`;
    percent.textContent = `${value}%`;
    track.setAttribute("aria-valuenow", String(value));
    // An estimate is only honest once there is a previous start to base it on.
    const seconds = remainingSeconds();
    eta.textContent = measured && !failed ? (seconds > 0 ? text.eta(seconds) : text.almost) : "";
    frame = requestAnimationFrame(paint);
  }

  function persist() {
    if (failed || !stages.every((stage) => stage.timed)) return;
    const payload = { version: 1, stages: {} };
    for (const stage of stages) payload.stages[stage.id] = stage.durationMs;
    try {
      localStorage.setItem(TIMINGS_KEY, JSON.stringify(payload));
    } catch {
      // Storage can be unavailable under restrictive browser policies.
    }
  }

  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    clearTimeout(skipTimer);
    clearTimeout(handover);
    persist();
    fill.style.width = "100%";
    percent.textContent = "100%";
    eta.textContent = "";
    track.setAttribute("aria-valuenow", "100");
    root.dataset.done = "true";
    setTimeout(() => root.remove(), FADE_MS);
  }

  const api = {
    version: 1,
    begin(id, detail) {
      const stage = stageById(id);
      if (!stage || finished || stage.state === "done") return;
      if (detail) stage.detail.textContent = detail;
      // Calling begin again on a running stage only sharpens its label - the
      // cluster becomes known by name halfway through it - and must not restart
      // the clock that measures how long the stage took.
      if (stage.state === "active") return;
      stage.state = "active";
      stage.startedAt = Date.now();
      stage.row.dataset.state = "active";
    },
    complete(id) {
      const stage = stageById(id);
      if (!stage || finished || stage.state === "done") return;
      stage.durationMs = elapsed(stage);
      stage.timed = stage.startedAt > 0;
      stage.state = "done";
      stage.row.dataset.state = "done";
      if (id === "ui") handover = setTimeout(finish, HANDOVER_AFTER_UI_MS);
      if (stages.every((entry) => entry.state === "done")) finish();
    },
    fail(id, message) {
      const stage = stageById(id);
      if (!stage || finished) return;
      failed = true;
      stage.state = "failed";
      stage.row.dataset.state = "failed";
      stage.detail.textContent = message || text.failed;
      // The application has its own error surface; the boot screen only has to
      // get out of its way, and let the failure be readable on the way out.
      clearTimeout(handover);
      handover = setTimeout(finish, FAILURE_HANDOVER_MS);
    },
    finish,
    isFinished: () => finished,
  };

  window.__kubedeckBoot = api;
  api.begin("ui");
  frame = requestAnimationFrame(paint);
})();
