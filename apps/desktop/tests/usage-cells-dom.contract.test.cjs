// The pod usage bars, rendered against real rows.
//
// This replaces the behavioural half of a grep contract that proved the three
// tiers by comparing where two strings appear in the file:
// `cell.indexOf('denominatorLabel="limit"') < cell.indexOf('denominatorLabel="request"')`.
// Source order is not precedence - the same file with the branches swapped and
// the JSX left where it was would still pass - and it says nothing about what a
// reader ends up seeing.
//
// The rule is worth holding because CPU limits are omitted far more often than
// memory ones: a limit-only bar left most pods with no visible CPU reading at
// all, which is what the fallback exists to fix.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React } = require("./helpers/dom.cjs");

const { PodResourceUsage } = loadComponent("components/resourceTable/UsageCells.tsx");

function usage(t, row) {
  const view = mount(React.createElement(PodResourceUsage, { row }));
  t.after(() => view.unmount());
  const bars = () => view.all(".resource-usage-bar");
  const cpu = () => bars()[0];
  return {
    view,
    cpu,
    ram: () => bars()[1],
    title: () => cpu().getAttribute("title"),
    reading: () => cpu().querySelector("small").textContent,
    fill: () => cpu().querySelector(".resource-usage-track span")?.getAttribute("style") ?? "",
  };
}

test("a limit is what the bar measures against when there is one", (t) => {
  const u = usage(t, {
    cpuUsage: "120m",
    podCpuUsagePercent: 60,
    podCpuRequestPercent: 240,
    podCpuLimitValue: 0.2,
    podCpuRequestValue: 0.05,
  });

  assert.match(u.title(), /limit/, "a limit outranks a request");
  assert.doesNotMatch(u.title(), /request/);
  assert.equal(u.reading(), "60%");
  assert.ok(!u.cpu().className.includes("is-soft"), "a hard limit is not a soft bar");
});

test("without a limit the request becomes the baseline, and says so", (t) => {
  // The tier that matters most in practice: a pod with a CPU request and no CPU
  // limit is the common shape, and it used to render an empty bar.
  const u = usage(t, {
    cpuUsage: "120m",
    podCpuUsagePercent: null,
    podCpuRequestPercent: 240,
    podCpuLimitValue: null,
    podCpuRequestValue: 0.05,
  });

  assert.match(u.title(), /request/);
  assert.match(u.title(), /no limit set/, "the reader has to know which baseline this is");
  assert.ok(u.cpu().className.includes("is-soft"), "a request is a softer promise than a limit and is marked as one");
});

test("a request can be exceeded: the track stops, the reading does not", (t) => {
  const u = usage(t, {
    cpuUsage: "120m",
    podCpuUsagePercent: null,
    podCpuRequestPercent: 240,
    podCpuLimitValue: null,
    podCpuRequestValue: 0.05,
  });

  assert.equal(u.reading(), "240%", "the real number is what the reader came for");
  assert.match(u.fill(), /width:\s*100%/, "the track cannot draw past full");
  assert.ok(u.cpu().className.includes("is-over"));
});

test("with neither limit nor request the raw reading is shown rather than an empty bar", (t) => {
  const u = usage(t, {
    cpuUsage: "120m",
    podCpuUsagePercent: null,
    podCpuRequestPercent: null,
    podCpuLimitValue: null,
    podCpuRequestValue: null,
  });

  assert.equal(u.reading(), "120m", "the number is what the reader came for, not N/A");
  assert.match(u.title(), /no limit or request set/);
  assert.equal(u.fill(), "", "there is no ratio to draw");
});

test("with no metrics at all the bar says so instead of showing a zero", (t) => {
  const u = usage(t, { cpuUsage: "", podCpuUsagePercent: null, podCpuRequestPercent: null, podCpuLimitValue: null, podCpuRequestValue: null });

  assert.equal(u.reading(), "N/A");
  assert.match(u.title(), /metrics N\/A/);
  assert.ok(!u.cpu().querySelector('[role="progressbar"]'), "an unmeasured bar is not a progress bar");
});

test("CPU and RAM are measured apart, each on its own tier", (t) => {
  // One pod can easily have a memory limit and no CPU limit, and the two bars
  // must not borrow each other's baseline.
  const u = usage(t, {
    cpuUsage: "120m",
    podCpuUsagePercent: null,
    podCpuRequestPercent: 240,
    podCpuRequestValue: 0.05,
    memoryUsage: "300Mi",
    podMemoryUsagePercent: 75,
    podMemoryLimitValue: 419430400,
  });

  assert.match(u.cpu().getAttribute("title"), /request/);
  assert.match(u.ram().getAttribute("title"), /limit/);
  assert.equal(u.ram().querySelector("small").textContent, "75%");
});
