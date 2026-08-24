const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { UsageHistoryStore, USAGE_BUCKET_MS, USAGE_RETENTION_MS, MAX_SERIES_PER_CLUSTER } = require("../dist/main/backend/resources/usageHistoryStore.js");
const { UsageHistorySampler, samplesFromTopOutput, parseCpuMillicoresValue, parseMemoryBytesValue } = require("../dist/main/backend/resources/usageHistorySampler.js");
const { workloadKeyForPod, formatWorkloadKey, inferWorkloadFromPodName } = require("../dist/main/backend/resources/workloadKey.js");
const { buildResourceContext } = require("../dist/main/backend/llm/context.js");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function deploymentPod(hash, suffix) {
  return {
    name: `api-${hash}-${suffix}`,
    namespace: "default",
    labels: { "pod-template-hash": hash },
    ownerReferences: [{ kind: "ReplicaSet", name: `api-${hash}`, controller: true }],
  };
}

test("the workload key survives a redeploy, which is what makes request sizing possible", () => {
  // A ReplicaSet name carries the pod-template-hash and therefore changes on
  // every rollout; keying history on it would reset the history exactly when
  // before/after comparison matters.
  const before = formatWorkloadKey(workloadKeyForPod(deploymentPod("8db54c48d", "hw9zw")));
  const after = formatWorkloadKey(workloadKeyForPod(deploymentPod("99f7c4b21", "abcde")));
  assert.equal(before, "Deployment/api");
  assert.equal(after, before);

  assert.equal(formatWorkloadKey(workloadKeyForPod({ name: "db-0", ownerReferences: [{ kind: "StatefulSet", name: "db" }] })), "StatefulSet/db");
  assert.equal(formatWorkloadKey(workloadKeyForPod({ name: "node-exporter-abcde", ownerReferences: [{ kind: "DaemonSet", name: "node-exporter" }] })), "DaemonSet/node-exporter");
  // Jobs created by a CronJob are as ephemeral as a ReplicaSet.
  assert.equal(formatWorkloadKey(workloadKeyForPod({ name: "backup-1700000000-xyz", ownerReferences: [{ kind: "Job", name: "backup-1700000000" }] })), "CronJob/backup");

  // The sampler sees only kubectl top output, so a name-only fallback exists
  // and is reported as inexact.
  assert.deepEqual(inferWorkloadFromPodName("web-7d9f8c6b5-2xk9p"), { kind: "Deployment", name: "web", exact: false });
  assert.equal(workloadKeyForPod({ name: "standalone" }), null);
  assert.equal(workloadKeyForPod(deploymentPod("8db54c48d", "hw9zw")).exact, true);
});

test("kubectl top output becomes samples in every unit metrics-server emits", () => {
  assert.equal(parseCpuMillicoresValue("250m"), 250);
  assert.equal(parseCpuMillicoresValue("2"), 2000);
  assert.equal(parseCpuMillicoresValue("1500000n"), 1.5);
  assert.equal(parseCpuMillicoresValue(""), null);
  assert.equal(parseMemoryBytesValue("512Mi"), 512 * 1024 * 1024);
  assert.equal(parseMemoryBytesValue("2Gi"), 2 * 1024 ** 3);
  assert.equal(parseMemoryBytesValue("nonsense"), null);

  const samples = samplesFromTopOutput("kube-system   coredns-8db54c48d-hw9zw   3m    21Mi\ndefault   api-1   250m   512Mi", true, "");
  assert.deepEqual(samples[0], { namespace: "kube-system", pod: "coredns-8db54c48d-hw9zw", cpuMillicores: 3, memoryBytes: 22020096 });
  assert.equal(samples[1].namespace, "default");
  // Without -A the namespace is absent from the output and has to be supplied.
  assert.equal(samplesFromTopOutput("api-1   250m   512Mi", false, "prod")[0].namespace, "prod");
});

test("percentiles separate sustained load from peaks, which is the request/limit distinction", () => {
  let now = 1_700_000_000_000;
  const store = new UsageHistoryStore(() => now);
  // Two replicas, steady 100m with a spike every 30 minutes.
  for (let index = 0; index < 120; index += 1) {
    const spike = index % 30 === 0;
    store.record("c1", [
      { namespace: "default", pod: "api-a", cpuMillicores: spike ? 400 : 100, memoryBytes: 50 * 1024 * 1024 },
      { namespace: "default", pod: "api-b", cpuMillicores: spike ? 380 : 90, memoryBytes: 48 * 1024 * 1024 },
    ]);
    now += 60_000;
  }
  store.attribute("c1", "default", "api-a", "Deployment/api");
  store.attribute("c1", "default", "api-b", "Deployment/api");

  const history = store.history("c1", "default", "api-a");
  assert.equal(history.pod.samples, 120);
  // p95 runs over five-minute averages (sustained), max over the peaks.
  assert.ok(history.pod.cpu.p95 < history.pod.cpu.max, "a spike must not drag the sustained percentile up to the peak");
  assert.equal(history.pod.cpu.max, 400);
  assert.equal(history.pod.cpu.p50, 100);

  // The workload pools per-pod values rather than summing replicas: a request
  // is sized per pod, so summing would inflate it by the replica count.
  assert.equal(history.workloadKey, "Deployment/api");
  assert.equal(history.workloadPods, 2);
  assert.equal(history.workload.samples, 240);
  assert.ok(history.workload.cpu.max <= 400, "pooling must not sum replicas");

  // Coverage counts wall-clock slots, so two replicas do not double it.
  assert.ok(history.pod.coverage > 0 && history.pod.coverage < 0.2);
  assert.equal(history.workload.coverage, history.pod.coverage);
  assert.equal(history.bucketMs, USAGE_BUCKET_MS);
});

test("history is bounded by retention and by series count", () => {
  let now = 1_700_000_000_000;
  const store = new UsageHistoryStore(() => now);
  store.record("c1", [{ namespace: "default", pod: "old", cpuMillicores: 10, memoryBytes: 10 }]);
  now += USAGE_RETENTION_MS + USAGE_BUCKET_MS;
  store.record("c1", [{ namespace: "default", pod: "new", cpuMillicores: 10, memoryBytes: 10 }]);
  assert.equal(store.history("c1", "default", "old").pod, null, "samples past the retention window are dropped");
  assert.ok(store.history("c1", "default", "new").pod);

  const many = new UsageHistoryStore(() => now);
  for (let index = 0; index < MAX_SERIES_PER_CLUSTER + 50; index += 1) {
    now += 1;
    many.record("c1", [{ namespace: "default", pod: `pod-${index}`, cpuMillicores: 1, memoryBytes: 1 }]);
  }
  assert.equal(many.seriesCount("c1"), MAX_SERIES_PER_CLUSTER);
  assert.equal(many.history("c1", "default", "pod-0").pod, null, "the least recently sampled series is evicted first");
});

test("history covers one run and leaves nothing on disk behind it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-usage-"));
  const metrics = path.join(root, "metrics");
  fs.mkdirSync(metrics, { recursive: true });
  const configStore = { paths: { metrics } };
  const runner = {
    run() {
      throw new Error("the sampler must not reach kubectl in this test");
    },
  };
  let now = 1_700_000_000_000;

  try {
    // Files left by a version that kept history between runs, plus a stray
    // temporary from an interrupted write.
    fs.writeFileSync(path.join(metrics, "c1.json"), JSON.stringify({ version: 1, series: [] }));
    fs.writeFileSync(path.join(metrics, "c1.json.123.tmp"), "partial");
    fs.writeFileSync(path.join(metrics, "unrelated.txt"), "keep me");

    const first = new UsageHistorySampler(configStore, runner, () => {}, { now: () => now });
    assert.equal(fs.existsSync(path.join(metrics, "c1.json")), false, "starting up removes recorded history");
    assert.equal(fs.existsSync(path.join(metrics, "c1.json.123.tmp")), false);
    assert.equal(fs.existsSync(path.join(metrics, "unrelated.txt")), true, "only history files are removed");

    for (let index = 0; index < 30; index += 1) {
      first.ingest("c1", samplesFromTopOutput("default api-8db54c48d-hw9zw 120m 400Mi", true, ""));
      now += 60_000;
    }
    first.attributePods("c1", [deploymentPod("8db54c48d", "hw9zw")]);
    assert.equal(first.history("c1", "default", "api-8db54c48d-hw9zw").pod.samples, 30);
    first.close();

    // Nothing was written during the run, so nothing carries over into it.
    assert.deepEqual(
      fs.readdirSync(metrics).filter((entry) => entry.endsWith(".json")),
      [],
      "a run must not write history to disk",
    );
    const second = new UsageHistorySampler(configStore, runner, () => {}, { now: () => now });
    assert.equal(second.history("c1", "default", "api-8db54c48d-hw9zw").pod, null, "a new run starts with an empty window");
    second.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the LLM context states coverage and how to read the percentiles", () => {
  let now = 1_700_000_000_000;
  const sampler = new UsageHistorySampler({ paths: { metrics: "" } }, {}, () => {}, { now: () => now, purgeOnStart: false });
  for (let index = 0; index < 120; index += 1) {
    sampler.ingest("c1", samplesFromTopOutput("default api-8db54c48d-hw9zw 120m 400Mi", true, ""));
    now += 60_000;
  }
  const history = sampler.history("c1", "default", "api-8db54c48d-hw9zw");

  const context = buildResourceContext(
    {
      clusterId: "c1",
      resource: "pods",
      kind: "Pod",
      namespace: "default",
      name: "api-8db54c48d-hw9zw",
      resourceObject: { podCpuRequestValue: 500, podCpuLimitValue: 1000, podMemoryRequestValue: 1073741824, podMemoryLimitValue: 2147483648 },
      usageHistory: history,
    },
    60000,
  ).context;

  assert.match(context, /USAGE HISTORY \(recorded by KubeDeck, not by Prometheus\)/);
  assert.match(context, /sampled only while KubeDeck was running/);
  // A conclusion drawn from two hours must not read as if it covered a day.
  assert.match(context, /coverage: \d+% of the window, 120 samples/);
  assert.match(context, /pod cpu: p50 120m/);
  // The configured values arrive already compared against the measurements,
  // so the answer never has to divide anything.
  assert.match(context, /cpu request: 500m; sustained p95 120m is 24% of the request/);
  assert.match(context, /memory request: 1 GiB; sustained p95 400 MiB is 39% of the request/);
  assert.match(context, /p50\/p95 are percentiles of five-minute averages \(sustained load, what a request should cover\)/);
  assert.match(context, /max is the highest five-minute peak \(what a limit must survive\)/);

  // Absent history must not be silently treated as low usage.
  const empty = buildResourceContext({ clusterId: "c1", resource: "pods", name: "x", resourceObject: {} }, 60000).context;
  assert.match(empty, /No usage history recorded yet\. Do not infer anything about request\/limit sizing from absent history\./);
  sampler.close();
});

test("a pod metrics-server started reporting after the list call still shows usage in the table", () => {
  const { applyPodMetricsSnapshot, parsePodMetrics } = require("../dist/main/backend/resources/metrics.js");
  let now = 1_700_000_000_000;
  const sampler = new UsageHistorySampler({ paths: { metrics: "" } }, {}, () => {}, { now: () => now, purgeOnStart: false });

  // The background sampler saw the pod; the table's own kubectl top call was
  // issued earlier, when metrics-server did not know about it yet.
  sampler.ingest("c1", samplesFromTopOutput("default nginx-dc4f957d7-kvv7c 2m 4Mi", true, ""));
  const rows = [
    { name: "nginx-dc4f957d7-kvv7c", namespace: "default" },
    { name: "coredns-8db54c48d-hw9zw", namespace: "kube-system" },
  ];
  const metrics = parsePodMetrics("kube-system coredns-8db54c48d-hw9zw 4m 43Mi", true);
  assert.equal(metrics.has("default/nginx-dc4f957d7-kvv7c"), false);

  sampler.backfillPodMetrics("c1", metrics, rows, true, "default");
  applyPodMetricsSnapshot({ metrics, allNamespaces: true }, rows);
  assert.equal(rows[0].cpuUsage, "2m", "the row must show what was recorded rather than N/A");
  assert.equal(rows[0].memoryUsage, "4Mi");
  // A backfilled row goes through the same math as one kubectl returned.
  assert.equal(rows[0].podCpuUsageValue, 2);
  assert.equal(rows[1].cpuUsage, "4m", "rows kubectl did return are untouched");

  // A pod that stopped reporting must go back to blank rather than keep its
  // last reading forever.
  now += 5 * 60_000;
  const stale = [{ name: "nginx-dc4f957d7-kvv7c", namespace: "default" }];
  const empty = new Map();
  sampler.backfillPodMetrics("c1", empty, stale, true, "default");
  applyPodMetricsSnapshot({ metrics: empty, allNamespaces: true }, stale);
  assert.equal(stale[0].cpuUsage, "");
  assert.equal(stale[0].memoryUsage, "");
  sampler.close();
});

test("a reading of zero is a measurement, not a missing sample", () => {
  let now = 1_700_000_000_000;
  const sampler = new UsageHistorySampler({ paths: { metrics: "" } }, {}, () => {}, { now: () => now, purgeOnStart: false });

  // An idle pod genuinely reports 0m. Treating that as absent left the whole
  // CPU history empty for pods that are simply not doing anything.
  for (let index = 0; index < 6; index += 1) {
    sampler.ingest("c1", samplesFromTopOutput("default nginx-dc4f957d7-44w8p 0m 4Mi", true, ""));
    now += 30_000;
  }
  const history = sampler.history("c1", "default", "nginx-dc4f957d7-44w8p");
  assert.deepEqual(history.pod.cpu, { avg: 0, p50: 0, p95: 0, max: 0 });
  assert.equal(history.points[0].cpuAvg, 0);
  assert.equal(history.points[0].cpuMax, 0);

  // The window is measured from real sample timestamps: bucket starts round
  // down to five minutes and would report a wider window than was observed.
  assert.ok(history.pod.lastSampleAt - history.pod.firstSampleAt < 5 * 60_000);

  const { applyPodMetricsSnapshot } = require("../dist/main/backend/resources/metrics.js");
  const rows = [{ name: "nginx-dc4f957d7-44w8p", namespace: "default" }];
  const metrics = new Map();
  sampler.backfillPodMetrics("c1", metrics, rows, true, "default");
  applyPodMetricsSnapshot({ metrics, allNamespaces: true }, rows);
  assert.equal(rows[0].cpuUsage, "0m", "an idle pod shows 0m in the table rather than N/A");
  assert.equal(rows[0].memoryUsage, "4Mi");
  sampler.close();
});

test("a metric that arrives late is averaged over its own samples", () => {
  let now = 1_700_000_000_000;
  const sampler = new UsageHistorySampler({ paths: { metrics: "" } }, {}, () => {}, { now: () => now, purgeOnStart: false });

  // metrics-server reports memory from its first scrape but needs two before
  // it can derive a CPU rate, so a bucket can hold more memory readings than
  // CPU ones. Dividing CPU by the shared sample count deflated it.
  sampler.ingest("c1", [{ namespace: "d", pod: "p", cpuMillicores: null, memoryBytes: 100 }]);
  sampler.ingest("c1", [{ namespace: "d", pod: "p", cpuMillicores: null, memoryBytes: 100 }]);
  sampler.ingest("c1", [{ namespace: "d", pod: "p", cpuMillicores: 60, memoryBytes: 100 }]);

  const history = sampler.history("c1", "d", "p");
  assert.equal(history.pod.cpu.avg, 60, "CPU must be averaged over the samples that carried it");
  assert.equal(history.pod.memory.avg, 100);
  assert.equal(history.pod.samples, 3);

  // The backfill must not invent an "N/A" string for the half that is missing.
  const missingCpu = new UsageHistorySampler({ paths: { metrics: "" } }, {}, () => {}, { now: () => now, purgeOnStart: false });
  missingCpu.ingest("c2", [{ namespace: "d", pod: "p", cpuMillicores: null, memoryBytes: 100 }]);
  const metrics = new Map();
  missingCpu.backfillPodMetrics("c2", metrics, [{ name: "p", namespace: "d" }], true, "d");
  assert.equal(metrics.get("d/p").cpu, "");
  assert.equal(metrics.get("d/p").memory, "100B");
  sampler.close();
  missingCpu.close();
});

test("the pod-usage route serves recorded samples without touching kubectl", async (t) => {
  const http = require("node:http");
  const { handlePodUsageRequest, matchPodUsageRoute } = require("../dist/main/backend/routes/podUsage.js");

  assert.equal(matchPodUsageRoute("POST", "/clusters/c1/pod-usage", "/clusters/c1/pod-usage"), null, "only GET is served");
  assert.equal(matchPodUsageRoute("GET", "/clusters/c1/resources/pods", "/clusters/c1/resources/pods"), null);
  assert.deepEqual(matchPodUsageRoute("GET", "/clusters/c1/pod-usage", "/clusters/c1/pod-usage"), { clusterId: "c1", namespace: "all" });
  assert.equal(matchPodUsageRoute("GET", "/clusters/c1/pod-usage", "/clusters/c1/pod-usage?namespace=prod").namespace, "prod");

  let now = 1_700_000_000_000;
  const sampler = new UsageHistorySampler({ paths: { metrics: "" } }, {}, () => {}, { now: () => now, purgeOnStart: false });
  sampler.ingest("c1", samplesFromTopOutput("default api-1 250m 512Mi\nkube-system coredns-1 3m 21Mi", true, ""));

  const configStore = {
    getCluster(clusterId) {
      if (clusterId !== "c1") throw new Error("unknown cluster");
      return { id: clusterId };
    },
  };
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const handled = handlePodUsageRequest(request, response, pathname, configStore, sampler, () => {});
    if (!handled) {
      response.statusCode = 404;
      response.end();
    }
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const all = await (await fetch(`${baseUrl}/clusters/c1/pod-usage?namespace=all`)).json();
  assert.equal(all.items.length, 2);
  const api = all.items.find((item) => item.pod === "api-1");
  assert.deepEqual(api, { namespace: "default", pod: "api-1", cpu: "250m", memory: "512Mi", cpuMillicores: 250, memoryBytes: 536870912 });

  // A namespaced request must not leak the rest of the cluster.
  const scoped = await (await fetch(`${baseUrl}/clusters/c1/pod-usage?namespace=default`)).json();
  assert.deepEqual(
    scoped.items.map((item) => item.pod),
    ["api-1"],
  );

  // A reading that stopped arriving drops out rather than being served forever.
  now += 5 * 60_000;
  assert.deepEqual((await (await fetch(`${baseUrl}/clusters/c1/pod-usage?namespace=all`)).json()).items, []);
  sampler.close();
});

test("a restart count is turned into a rate, because four restarts mean opposite things at two hours and at five weeks", () => {
  const build = (ageMs, restarts) => {
    const started = new Date(Date.now() - ageMs).toISOString();
    return buildResourceContext(
      {
        clusterId: "c1",
        resource: "pods",
        kind: "Pod",
        namespace: "kube-system",
        name: "metrics-server-7d9c6b4f8-abcde",
        resourceObject: { status: { phase: "Running", startTime: started, qosClass: "Burstable" } },
        describe: `Restart Count:  ${restarts}\nStart Time:  ${started}\n`,
      },
      60000,
    ).context;
  };

  // The count alone reads as instability; the rate is what makes it judgeable.
  assert.match(build(37 * 86_400_000, 4), /restart rate: 4 restarts over 37d of uptime, about one every 9 days/);
  assert.match(build(2 * 3_600_000, 4), /restart rate: 4 restarts over 2h of uptime, about 48\.0 per day/);

  // A Pod that never restarted has no rate to state, and an unknown start time
  // must not produce an invented one.
  assert.doesNotMatch(build(37 * 86_400_000, 0), /restart rate:/);
  const noStart = buildResourceContext({ clusterId: "c1", resource: "pods", kind: "Pod", name: "x", resourceObject: {}, describe: "Restart Count:  4\n" }, 60000).context;
  assert.doesNotMatch(noStart, /restart rate:/);
});

test("memory readings are shown at the unit a reader thinks in, not the one kubectl happened to print", () => {
  const { formatMemory } = require("../dist/main/backend/resources/metrics.js");
  const ki = (value) => formatMemory(value * 1024);

  // The unit follows magnitude. Picking it by exact division instead kept
  // 403840Ki as "403840Ki", because it divides by 1024 evenly.
  assert.equal(ki(403840), "394.4Mi");
  assert.equal(ki(10880), "10.6Mi");
  assert.equal(ki(40704), "39.8Mi");

  // Below a megabyte there is nothing to promote to.
  assert.equal(ki(128), "128Ki");
  assert.equal(ki(512), "512Ki");

  // Exactness still decides the decimals, so round values stay round.
  assert.equal(ki(1024), "1Mi");
  assert.equal(ki(1048576), "1Gi");
  assert.equal(ki(2097152), "2Gi");

  assert.equal(formatMemory(512), "512B");
  assert.equal(formatMemory(0), "0Mi");
  assert.equal(formatMemory(null), "N/A");
});

test("the Metrics API response keeps the precision and the scrape time that kubectl top throws away", () => {
  const { samplesFromMetricsApi } = require("../dist/main/backend/resources/usageHistorySampler.js");

  const [sample] = samplesFromMetricsApi(
    JSON.stringify({
      kind: "PodMetricsList",
      items: [
        {
          metadata: { name: "metrics-server-x", namespace: "kube-system" },
          timestamp: "2026-08-19T12:00:00Z",
          window: "15s",
          containers: [
            { name: "server", usage: { cpu: "3470000n", memory: "80281600" } },
            { name: "sidecar", usage: { cpu: "530000n", memory: "1048576" } },
          ],
        },
      ],
    }),
  );

  // `kubectl top` would render this pod as "4m". A request sized against 4m
  // instead of 4.0m is fine; one sized against a value rounded down by a
  // seventh, as happens at 3.47m, is not.
  assert.equal(sample.cpuMillicores, 4);
  assert.equal(sample.memoryBytes, 80281600 + 1048576);
  assert.equal(sample.namespace, "kube-system");
  assert.equal(sample.sampledAt, Date.parse("2026-08-19T12:00:00Z"));

  // Anything unusable must drop out rather than land as a zero reading.
  assert.deepEqual(samplesFromMetricsApi("not json"), []);
  assert.deepEqual(samplesFromMetricsApi(JSON.stringify({ items: [{ metadata: { name: "p" }, containers: [] }] })), []);

  // A pod with no timestamp still records; it just cannot be deduplicated.
  const [undated] = samplesFromMetricsApi(JSON.stringify({ items: [{ metadata: { name: "p", namespace: "ns" }, containers: [{ usage: { cpu: "1m", memory: "1Mi" } }] }] }));
  assert.equal(undated.sampledAt, null);
});

test("polling faster than metrics-server scrapes records one sample per scrape, not one per poll", () => {
  const { samplesFromMetricsApi } = require("../dist/main/backend/resources/usageHistorySampler.js");
  const scrape = (iso, cpu) => samplesFromMetricsApi(JSON.stringify({ items: [{ metadata: { name: "api", namespace: "default" }, timestamp: iso, containers: [{ usage: { cpu, memory: "1Mi" } }] }] }));

  let now = 1_700_000_000_000;
  const store = new UsageHistoryStore(() => now);
  // Our timer and theirs are not phase-locked, so the same scrape comes back
  // several times before a new one appears.
  for (let index = 0; index < 3; index += 1) {
    store.record("c1", scrape("2026-08-19T12:00:00Z", "3470000n"));
    now += 15_000;
  }
  store.record("c1", scrape("2026-08-19T12:00:15Z", "9000000n"));

  const history = store.history("c1", "default", "api");
  assert.equal(history.pod.samples, 2, "three deliveries of one scrape are one measurement");
  // Counting the repeats would drag the average toward 4.85 - the value that
  // happened to repeat - instead of the true 6.235.
  assert.equal(history.pod.cpu.avg, 6.235);
});

test("the fine grid feeds the chart and never the percentiles", () => {
  const { USAGE_BUCKET_MS, USAGE_FINE_BUCKET_MS, USAGE_FINE_RETENTION_MS, USAGE_RETENTION_MS } = require("../dist/main/backend/resources/usageHistoryStore.js");
  assert.equal(USAGE_FINE_BUCKET_MS, 15_000);
  assert.equal(USAGE_FINE_RETENTION_MS, 60 * 60_000);

  let now = Math.floor(1_700_000_000_000 / USAGE_BUCKET_MS) * USAGE_BUCKET_MS;
  const store = new UsageHistoryStore(() => now);
  // Two hours of 15-second samples: longer than the fine window, shorter than
  // the coarse one.
  const total = (2 * 60 * 60_000) / 15_000;
  for (let index = 0; index < total; index += 1) {
    store.record("c1", [{ namespace: "default", pod: "api", cpuMillicores: 10, memoryBytes: 1024 * 1024, sampledAt: now }]);
    now += 15_000;
  }

  const history = store.history("c1", "default", "api");
  assert.equal(history.bucketMs, USAGE_BUCKET_MS);
  assert.equal(history.fineBucketMs, USAGE_FINE_BUCKET_MS);
  assert.equal(history.retentionMs, USAGE_RETENTION_MS);

  // Every sample is stored twice, once per grid, and must still be counted
  // once: the aggregate reads the coarse grid alone.
  assert.equal(history.pod.samples, total);
  assert.equal(history.points.length, 24, "two hours of five-minute buckets");
  // The fine grid expires an hour in, so it holds the tail and not the whole run.
  assert.ok(history.finePoints.length <= USAGE_FINE_RETENTION_MS / USAGE_FINE_BUCKET_MS + 1, `fine points bounded, got ${history.finePoints.length}`);
  assert.ok(history.finePoints.length >= 200, `fine points cover the last hour, got ${history.finePoints.length}`);
  assert.ok(history.finePoints[0].start >= history.points[0].start, "the fine tail starts later than the coarse history");

  // Coverage is a property of the 24 h window and must not be inflated by the
  // 240 extra fine buckets sitting inside the same two hours.
  assert.equal(history.pod.coverage, Math.round((24 / (USAGE_RETENTION_MS / USAGE_BUCKET_MS)) * 1000) / 1000);
});

test("the sampler reads the Metrics API rather than the table kubectl top prints", async () => {
  const { UsageHistorySampler: Sampler } = require("../dist/main/backend/resources/usageHistorySampler.js");
  const commands = [];
  const runner = {
    run: async (command) => {
      commands.push(command);
      return {
        stdout: JSON.stringify({ items: [{ metadata: { name: "api", namespace: "default" }, timestamp: "2026-08-19T12:00:00Z", containers: [{ usage: { cpu: "2m", memory: "5Mi" } }] }] }),
        stderr: "",
      };
    },
  };
  const configStore = {
    paths: { metrics: "" },
    load: () => ({ settings: { kubectlPath: "kubectl" } }),
    getCluster: () => ({ id: "c1", kubeconfigPath: "kubeconfig" }),
    listClusters: () => [],
  };
  const sampler = new Sampler(configStore, runner, () => {}, { purgeOnStart: false });
  sampler.ensureCluster("c1");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  sampler.close();

  assert.ok(commands.length > 0, "a tick must issue a kubectl call");
  const args = commands[0].args ?? commands[0].arguments ?? [];
  assert.ok(args.includes("--raw"), `expected a raw API read, got ${JSON.stringify(args)}`);
  assert.ok(args.includes("/apis/metrics.k8s.io/v1beta1/pods"), `expected the pod metrics endpoint, got ${JSON.stringify(args)}`);
  assert.ok(!args.includes("top"), "kubectl top rounds the reading and drops the scrape time");
});
