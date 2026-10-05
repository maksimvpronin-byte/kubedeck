// Coloured log output, rendered by the real LogsTab.
//
// Reported from a real cluster: programs that colour their output (loggers,
// test runners, anything that thinks it has a terminal) write escape sequences
// into the log, and the Logs tab printed them - a box for the escape character
// and "[32m" after it - instead of the colours they ask for.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React } = require("./helpers/dom.cjs");

const ansi = loadComponent("utils/ansi.ts");
const { LogsTab } = loadComponent("components/LogsTab.tsx");

const ESC = "\x1b";

function logs(t, content, extra = {}) {
  const view = mount(
    React.createElement(LogsTab, {
      content,
      loading: false,
      query: "",
      onQueryChange: () => {},
      tail: 100,
      onTailChange: () => {},
      previous: false,
      onPreviousChange: () => {},
      timestamps: false,
      onTimestampsChange: () => {},
      follow: false,
      onFollowChange: () => {},
      containers: ["app"],
      selectedContainer: "app",
      onContainerChange: () => {},
      onRefresh: () => {},
      refreshFailed: false,
      t: (key) => key,
      onCopy: () => {},
      downloadLoading: false,
      onDownloadVisible: () => {},
      onDownloadFull: () => {},
      ...extra,
    }),
  );
  t.after(() => view.unmount());
  return view;
}

test("escape sequences are shown as colours, not as characters", (t) => {
  const view = logs(t, `${ESC}[32mINFO${ESC}[0m server started\n${ESC}[1;31mERROR${ESC}[0m ${ESC}]0;title${ESC}\\boom${ESC}[K`);
  const output = view.first(".logs-output");
  assert.equal(output.textContent, "INFO server started\nERROR boom");
  assert.doesNotMatch(output.textContent, /\x1b|\[\d+m/);

  const [info, error] = view.all(".log-line span[style]");
  assert.equal(info.textContent, "INFO");
  assert.equal(info.style.color, "var(--terminal-green, #86c59d)");
  assert.equal(error.textContent, "ERROR");
  assert.equal(error.style.color, "var(--terminal-red, #d98787)");
  assert.equal(error.style.fontWeight, "700");
});

test("the filter and the search read the text on screen, not the escapes", (t) => {
  // "32mready" is in the raw text but not on screen; "ready" spans a colour change.
  const view = logs(t, `${ESC}[32mrea${ESC}[33mdy${ESC}[0m\nother line`, { query: "ready" });
  assert.equal(view.text(".logs-search span"), "1/2");
  const marks = view.all(".log-line mark");
  assert.equal(marks.length, 1, "one occurrence is one mark, even across two colours");
  assert.equal(marks[0].textContent, "ready");
  assert.equal(marks[0].querySelectorAll("span[style]").length, 2);
});

test("a colour carries into the next line until it is reset", () => {
  const lines = ansi.parseAnsiLines([`${ESC}[31mTraceback:`, "  at frame", `${ESC}[0mdone`]);
  assert.deepEqual(
    lines.map((line) => line.text),
    ["Traceback:", "  at frame", "done"],
  );
  assert.equal(lines[1].runs[0].style.color, "var(--terminal-red, #d98787)");
  assert.deepEqual(lines[2].runs, []);
});

test("256-colour and true-colour codes are read, bright colours keep the theme palette", () => {
  const [line] = ansi.parseAnsiLines([`${ESC}[38;5;196ma${ESC}[38;2;10;20;30mb${ESC}[94mc${ESC}[48;5;2md`]);
  assert.equal(line.text, "abcd");
  assert.deepEqual(
    line.runs.map((run) => run.style.color),
    ["rgb(255 0 0)", "rgb(10 20 30)", "var(--terminal-bright-blue, #9cc4e6)", "var(--terminal-bright-blue, #9cc4e6)"],
  );
  assert.equal(line.runs[3].style.backgroundColor, "var(--terminal-green, #86c59d)");
});

test("copying takes the text without escapes", () => {
  assert.equal(ansi.stripAnsi(`${ESC}[32mok${ESC}[0m ${ESC}[2Kdone`), "ok done");
  assert.equal(ansi.stripAnsi("plain"), "plain");
});
