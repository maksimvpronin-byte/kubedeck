// Shared harness for the renderer contract tests: transpiling a renderer
// module in-process with stubbed imports, and a deterministic scheduler.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const rendererRoot = path.resolve(__dirname, "../../src/renderer");

const rendererModuleCache = new Map();

function resolveRendererModule(fromRelativePath, specifier) {
  const base = path.dirname(path.join(rendererRoot, fromRelativePath));
  const target = path.resolve(base, specifier);
  for (const candidate of [`${target}.ts`, `${target}.tsx`, path.join(target, "index.ts")]) {
    if (fs.existsSync(candidate)) return path.relative(rendererRoot, candidate).split(path.sep).join("/");
  }
  return "";
}

// The cache is keyed by the stubs as well as the path: the same module is
// loaded here against a stub of React that does nothing, and in the DOM tests
// against the real one.
function loadTypeScript(relativePath, stubs = {}, cacheKey = "") {
  const source = fs.readFileSync(path.join(rendererRoot, relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => {
    if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
    if (specifier.startsWith(".")) {
      const resolved = resolveRendererModule(relativePath, specifier);
      if (resolved) {
        const cached = `${cacheKey}\u0000${resolved}`;
        if (rendererModuleCache.has(cached)) return rendererModuleCache.get(cached);
        const loaded = loadTypeScript(resolved, stubs, cacheKey);
        rendererModuleCache.set(cached, loaded);
        return loaded;
      }
    }
    if (specifier === "react")
      return {
        useCallback: (value) => value,
        useEffect: () => undefined,
        useMemo: (value) => value(),
        useRef: (value) => ({ current: value }),
        useState: (value) => [typeof value === "function" ? value() : value, () => undefined],
      };
    if (specifier === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
    return {};
  };
  new Function("module", "exports", "require", output)(module, module.exports, localRequire);
  return module.exports;
}

function createTestScheduler() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  const scheduler = {
    now: () => now,
    setTimeout: (callback, delay) => {
      sequence += 1;
      timers.set(sequence, { callback, at: now + delay });
      return sequence;
    },
    clearTimeout: (timer) => timers.delete(timer),
  };
  return {
    scheduler,
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers.entries()].sort((left, right) => left[1].at - right[1].at)) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.callback();
      }
    },
    pending: () => timers.size,
  };
}

module.exports = { rendererRoot, loadTypeScript, createTestScheduler };
