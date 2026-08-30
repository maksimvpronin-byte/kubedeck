// The usage history chart, rendered and switched between its two windows.
//
// This replaces two grep contracts that read UsageHistoryChart.tsx for
// `useState<Range>("fine")`, `history.finePoints ?? []` and the exact text of
// the line that formats a bar's tooltip. A default in the source is not a
// default on screen, and matching the template literal that builds a title
// proves only that the template exists - not that a bar holding one measurement
// ends up with one number on it.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React } = require("./helpers/dom.cjs");

const { UsageHistoryChart } = loadComponent("components/UsageHistoryChart.tsx");

const aggregate = (over = {}) => ({
  cpu: { p50: 50, p95: 90, max: 120 },
  memory: { p50: 200_000_000, p95: 300_000_000, max: 350_000_000 },
  from: Date.UTC(2026, 7, 29, 9, 0, 0),
  to: Date.UTC(2026, 7, 29, 10, 0, 0),
  samples: 240,
  ...over,
});

// A bucket. `samples` is how many scrapes landed in it after deduplication.
const point = (minute, { samples = 4, cpuAvg = 50, cpuMax = 80, memoryAvg = 200_000_000, memoryMax = 250_000_000 } = {}) => ({
  start: Date.UTC(2026, 7, 29, 9, minute, 0),
  samples,
  cpuAvg,
  cpuMax,
  memoryAvg,
  memoryMax,
});

function history(over = {}) {
  return {
    pod: aggregate(),
    workload: null,
    workloadPods: 1,
    workloadKey: "",
    // The two views hold different numbers on purpose: a percentile that quietly
    // followed the view on screen would otherwise be invisible to the test below.
    points: [point(0, { cpuAvg: 20, cpuMax: 30 }), point(5, { cpuAvg: 20, cpuMax: 30 }), point(10, { cpuAvg: 20, cpuMax: 30 })],
    finePoints: [point(55), point(56), point(57), point(58)],
    retentionMs: 24 * 3_600_000,
    fineRetentionMs: 30 * 60_000,
    ...over,
  };
}

function chart(t, over = {}) {
  const view = mount(
    React.createElement(UsageHistoryChart, {
      history: history(over),
      cpuRequest: over.cpuRequest ?? null,
      cpuLimit: over.cpuLimit ?? null,
      memoryRequest: null,
      memoryLimit: null,
    }),
  );
  t.after(() => view.unmount());
  return {
    view,
    bars: () => view.all(".usage-history-metric")[0].querySelectorAll(".usage-history-bar"),
    titles: () => [...view.all(".usage-history-metric")[0].querySelectorAll(".usage-history-bar")].map((bar) => bar.getAttribute("title")),
    rangeButtons: () => view.all(".usage-history-range button"),
    heights: () => [...view.all(".usage-history-metric")[0].querySelectorAll(".usage-history-bar-peak")].map((bar) => bar.getAttribute("style")),
  };
}

test("with nothing recorded yet the panel explains both reasons it can be empty", (t) => {
  const c = chart(t, { pod: null, points: [], finePoints: [] });
  const text = c.view.text(".resource-summary-empty");

  assert.match(text, /metrics-server itself needs two scrapes/, "one reason is the cluster's");
  assert.match(text, /refreshes on its own/, "the other is that waiting is enough");
  assert.equal(c.view.all(".usage-history-bar").length, 0);
});

test("the live tail is what opens, with the whole window one click away", (t) => {
  // The panel is opened to see what a pod is doing now, so the fine points are
  // the default view. The buttons name their own windows, from the response.
  const c = chart(t);

  assert.deepEqual(
    [...c.rangeButtons()].map((button) => button.textContent.trim()),
    ["30 min", "24 h"],
  );
  assert.equal(c.rangeButtons()[0].getAttribute("aria-pressed"), "true");
  assert.equal(c.bars().length, 4, "four fine buckets, not the three coarse ones");
});

test("switching to the whole window changes the bars and not the percentiles", (t) => {
  // Two different p95 values for one pod would be worse than none, so the
  // percentiles describe the whole recorded window whichever view is on screen.
  const c = chart(t);
  const before = c.view.text(".usage-history-metric-head span");

  c.view.click(c.rangeButtons()[1]);

  assert.equal(c.rangeButtons()[1].getAttribute("aria-pressed"), "true");
  assert.equal(c.bars().length, 3, "the coarse buckets now");
  assert.equal(c.view.text(".usage-history-metric-head span"), before, "the numbers above them did not move");
  assert.match(before, /over the whole window/);
});

test("a response without the fine points still draws, and offers no switch", (t) => {
  // An older backend sends no finePoints at all. Blanking the drawer over a
  // missing field would be worse than showing the coarse view.
  const c = chart(t, { finePoints: undefined });

  assert.equal(c.rangeButtons().length, 0, "there is nothing finer to switch to");
  assert.equal(c.bars().length, 3, "and the coarse points are drawn instead of nothing");
});

test("a bar holding one scrape reports one number instead of the same one twice", (t) => {
  // "avg 3 GiB · max 3 GiB" is what a 15-second bucket produces, because after
  // deduplication it holds exactly one measurement.
  const c = chart(t, { finePoints: [point(55, { samples: 1, cpuAvg: 50, cpuMax: 50 }), point(56, { samples: 6, cpuAvg: 50, cpuMax: 90 })] });
  const [single, several] = c.titles();

  assert.doesNotMatch(single, /avg|max|samples/, "one measurement is one number");
  assert.match(single, /50m$/);
  assert.match(several, /avg 50m · max 90m · 6 samples/);
});

test("the scale holds the request and the limit, so a quiet pod does not look saturated", (t) => {
  // Scaling to the tallest bar alone would draw a pod sitting at a tenth of its
  // request as a full column.
  const quiet = chart(t, { finePoints: [point(55, { cpuMax: 10 })], cpuRequest: 500, cpuLimit: 1000 });
  const alone = chart(t, { finePoints: [point(55, { cpuMax: 10 })] });

  assert.match(quiet.heights()[0], /height:\s*1%/, "one percent of a scale that holds the limit");
  assert.match(alone.heights()[0], /height:\s*100%/, "and the full height when there is nothing else to hold");
});
