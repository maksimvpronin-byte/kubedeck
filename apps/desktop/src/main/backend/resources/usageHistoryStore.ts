// Usage history is sampled by KubeDeck itself rather than read from
// Prometheus, so it only covers the time the application was running. Every
// number carries the sample count behind it, and a reader that needs to know
// how complete the window is gets `coverage` instead of having to assume.

export const USAGE_BUCKET_MS = 5 * 60_000;
export const USAGE_RETENTION_MS = 24 * 60 * 60_000;
export const USAGE_BUCKETS_PER_WINDOW = USAGE_RETENTION_MS / USAGE_BUCKET_MS;

// A second, finer grid exists only so the chart can move at the rate
// metrics-server actually publishes. It is deliberately NOT used for the
// percentiles: mixing 15-second points for the last hour with five-minute
// points for the other 23 would put half the population inside 4% of the
// window, and p50/p95 would describe the last hour rather than the day.
export const USAGE_FINE_BUCKET_MS = 15_000;
export const USAGE_FINE_RETENTION_MS = 60 * 60_000;
// A busy cluster has far more pods than anyone browses. The cap keeps the file
// and the memory bounded; the least recently sampled series is dropped first.
export const MAX_SERIES_PER_CLUSTER = 2000;

export interface UsageSample {
  namespace: string;
  pod: string;
  cpuMillicores: number | null;
  memoryBytes: number | null;
  // When metrics-server reports the scrape time, a poll that lands before the
  // next scrape returns the previous reading again. Recording that twice would
  // count one measurement as two and pull the average toward whichever value
  // happened to repeat, so the timestamp is what makes 15-second polling safe.
  sampledAt?: number | null;
}

// Sums rather than averages: a bucket is updated in place as samples arrive.
// CPU and memory carry their own counts because they can be missing
// independently - metrics-server reports memory from its first scrape but
// needs two before it can derive a CPU rate - and because a reading of zero is
// a measurement, not an absence. Dividing by the shared sample count would
// deflate the average of whichever metric arrived late.
export interface UsageBucket {
  start: number;
  samples: number;
  cpuSamples: number;
  cpuSum: number;
  cpuMax: number;
  memorySamples: number;
  memorySum: number;
  memoryMax: number;
}

export interface UsageSeries {
  namespace: string;
  pod: string;
  workload: string;
  // Real sample timestamps: bucket starts round down to five minutes, which
  // would report a window wider than what was actually observed.
  firstSampleAt: number;
  updatedAt: number;
  buckets: UsageBucket[];
  // The same measurements on the 15-second grid, kept for one hour.
  fineBuckets: UsageBucket[];
  // Scrape time of the last reading accepted for this pod, 0 when unknown.
  lastSampledAt: number;
}

export interface UsageStat {
  avg: number | null;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export interface UsageAggregate {
  samples: number;
  buckets: number;
  windowStart: number;
  windowEnd: number;
  firstSampleAt: number | null;
  lastSampleAt: number | null;
  // Observed buckets over the buckets the window could hold: 1 means the app
  // ran for the whole window, 0.1 means these numbers rest on ~2.4 hours.
  coverage: number;
  cpu: UsageStat;
  memory: UsageStat;
}

export interface UsageHistoryResult {
  pod: UsageAggregate | null;
  workload: UsageAggregate | null;
  workloadKey: string;
  workloadExact: boolean;
  workloadPods: number;
  points: Array<{ start: number; cpuAvg: number | null; cpuMax: number | null; memoryAvg: number | null; memoryMax: number | null; samples: number }>;
  bucketMs: number;
  retentionMs: number;
  // The last hour at the rate metrics-server publishes. Chart only - the
  // aggregates above are computed from `points` and never from these.
  finePoints: Array<{ start: number; cpuAvg: number | null; cpuMax: number | null; memoryAvg: number | null; memoryMax: number | null; samples: number }>;
  fineBucketMs: number;
  fineRetentionMs: number;
}

interface ClusterHistory {
  series: Map<string, UsageSeries>;
  // Workloads learned from a pod list before the pod's first sample, applied
  // when its series is created. Bounded: an entry only waits for one sample.
  pendingWorkloads: Map<string, string>;
}

const MAX_PENDING_WORKLOADS = 20_000;

function seriesKey(namespace: string, pod: string): string {
  return `${namespace}\u0000${pod}`;
}

function bucketStart(timestamp: number): number {
  return Math.floor(timestamp / USAGE_BUCKET_MS) * USAGE_BUCKET_MS;
}

type UsagePoint = { start: number; cpuAvg: number | null; cpuMax: number | null; memoryAvg: number | null; memoryMax: number | null; samples: number };

function pointsFrom(buckets: UsageBucket[] | undefined, windowStart: number): UsagePoint[] {
  return (buckets ?? [])
    .filter((bucket) => bucket.start >= windowStart && bucket.samples > 0)
    .map((bucket) => ({
      start: bucket.start,
      cpuAvg: bucket.cpuSamples > 0 ? Math.round((bucket.cpuSum / bucket.cpuSamples) * 1000) / 1000 : null,
      cpuMax: bucket.cpuSamples > 0 ? bucket.cpuMax : null,
      memoryAvg: bucket.memorySamples > 0 ? Math.round(bucket.memorySum / bucket.memorySamples) : null,
      memoryMax: bucket.memorySamples > 0 ? bucket.memoryMax : null,
      samples: bucket.samples,
    }));
}

function fineBucketStart(timestamp: number): number {
  return Math.floor(timestamp / USAGE_FINE_BUCKET_MS) * USAGE_FINE_BUCKET_MS;
}

// Both grids fold a sample the same way; only the slot width differs.
function addSample(buckets: UsageBucket[], start: number, sample: UsageSample): void {
  let bucket = buckets.at(-1);
  if (!bucket || bucket.start !== start) {
    bucket = { start, samples: 0, cpuSamples: 0, cpuSum: 0, cpuMax: 0, memorySamples: 0, memorySum: 0, memoryMax: 0 };
    buckets.push(bucket);
  }
  bucket.samples += 1;
  if (sample.cpuMillicores !== null) {
    bucket.cpuSamples += 1;
    bucket.cpuSum += sample.cpuMillicores;
    bucket.cpuMax = Math.max(bucket.cpuMax, sample.cpuMillicores);
  }
  if (sample.memoryBytes !== null) {
    bucket.memorySamples += 1;
    bucket.memorySum += sample.memoryBytes;
    bucket.memoryMax = Math.max(bucket.memoryMax, sample.memoryBytes);
  }
}

// `addSample` only ever touches the last bucket, so both grids are sorted by
// `start` and everything expired sits at the front. Rebuilding the arrays with
// `filter` instead cost two new arrays per series on every sample tick - 4000
// of them for a full cluster, every fifteen seconds, to usually drop nothing:
// the coarse grid expires once every five minutes.
function dropExpired(buckets: UsageBucket[], cutoff: number): void {
  if (buckets.length === 0 || buckets[0].start >= cutoff) return;
  let first = 1;
  while (first < buckets.length && buckets[first].start < cutoff) first += 1;
  buckets.splice(0, first);
}

function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function statFrom(averages: number[], maxima: number[]): UsageStat {
  if (averages.length === 0) return { avg: null, p50: null, p95: null, max: null };
  const sorted = [...averages].sort((left, right) => left - right);
  const total = averages.reduce((sum, value) => sum + value, 0);
  return {
    avg: Math.round((total / averages.length) * 1000) / 1000,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    // A loop, not Math.max(...maxima): a large workload pools more buckets
    // than a call may take arguments.
    max: maxima.length ? maxima.reduce((highest, value) => (value > highest ? value : highest), Number.NEGATIVE_INFINITY) : null,
  };
}

// Percentiles run over per-bucket averages, which is the sustained level a
// request should be sized against; the peak is kept separately as the maximum
// of the per-bucket maxima, which is what a limit has to survive.
function aggregate(seriesList: UsageSeries[], windowStart: number, windowEnd: number): UsageAggregate | null {
  const cpuAverages: number[] = [];
  const cpuMaxima: number[] = [];
  const memoryAverages: number[] = [];
  const memoryMaxima: number[] = [];
  let samples = 0;
  let buckets = 0;
  let firstSampleAt: number | null = null;
  let lastSampleAt: number | null = null;

  for (const series of seriesList) {
    for (const bucket of series.buckets) {
      if (bucket.start < windowStart || bucket.samples === 0) continue;
      buckets += 1;
      samples += bucket.samples;
      // An idle pod legitimately reports 0m, so presence is decided by the
      // per-metric count and never by the value being above zero.
      if (bucket.cpuSamples > 0) {
        cpuAverages.push(bucket.cpuSum / bucket.cpuSamples);
        cpuMaxima.push(bucket.cpuMax);
      }
      if (bucket.memorySamples > 0) {
        memoryAverages.push(bucket.memorySum / bucket.memorySamples);
        memoryMaxima.push(bucket.memoryMax);
      }
    }
    if (series.firstSampleAt > 0 && series.firstSampleAt >= windowStart) {
      firstSampleAt = firstSampleAt === null ? series.firstSampleAt : Math.min(firstSampleAt, series.firstSampleAt);
    }
    lastSampleAt = lastSampleAt === null ? series.updatedAt : Math.max(lastSampleAt, series.updatedAt);
  }

  if (samples === 0) return null;

  // Replicas share the wall clock, so coverage counts distinct bucket slots,
  // not the pooled bucket count: three replicas do not make a window complete.
  const distinctSlots = new Set<number>();
  for (const series of seriesList) {
    for (const bucket of series.buckets) {
      if (bucket.start >= windowStart && bucket.samples > 0) distinctSlots.add(bucket.start);
    }
  }

  return {
    samples,
    buckets,
    windowStart,
    windowEnd,
    firstSampleAt,
    lastSampleAt,
    coverage: Math.min(1, Math.round((distinctSlots.size / USAGE_BUCKETS_PER_WINDOW) * 1000) / 1000),
    cpu: statFrom(cpuAverages, cpuMaxima),
    memory: statFrom(memoryAverages, memoryMaxima),
  };
}

export class UsageHistoryStore {
  private readonly clusters = new Map<string, ClusterHistory>();

  constructor(private readonly now: () => number = Date.now) {}

  private cluster(clusterId: string): ClusterHistory {
    let entry = this.clusters.get(clusterId);
    if (!entry) {
      entry = { series: new Map(), pendingWorkloads: new Map() };
      this.clusters.set(clusterId, entry);
    }
    return entry;
  }

  record(clusterId: string, samples: UsageSample[]): void {
    if (samples.length === 0) return;
    const timestamp = this.now();
    const start = bucketStart(timestamp);
    const fineStart = fineBucketStart(timestamp);
    const cluster = this.cluster(clusterId);

    for (const sample of samples) {
      if (!sample.pod) continue;
      if (sample.cpuMillicores === null && sample.memoryBytes === null) continue;
      const key = seriesKey(sample.namespace, sample.pod);
      let series = cluster.series.get(key);
      if (!series) {
        const workload = cluster.pendingWorkloads.get(key) ?? "";
        cluster.pendingWorkloads.delete(key);
        series = { namespace: sample.namespace, pod: sample.pod, workload, firstSampleAt: timestamp, updatedAt: timestamp, buckets: [], fineBuckets: [], lastSampledAt: 0 };
        cluster.series.set(key, series);
      }

      // Polling faster than metrics-server scrapes hands us the same reading
      // more than once. Dropping it here keeps one scrape worth exactly one
      // sample, whatever the phase between our timer and theirs.
      const sampledAt = sample.sampledAt ?? null;
      if (sampledAt !== null && sampledAt === series.lastSampledAt) continue;
      if (sampledAt !== null) series.lastSampledAt = sampledAt;

      series.updatedAt = timestamp;
      addSample(series.buckets, start, sample);
      addSample(series.fineBuckets, fineStart, sample);
    }

    this.prune(clusterId);
  }

  // The workload a pod belongs to is learned from a pod list, which the sampler
  // itself never fetches; until then a series carries no workload and only its
  // own history is available.
  attribute(clusterId: string, namespace: string, pod: string, workload: string): void {
    if (!workload) return;
    const cluster = this.cluster(clusterId);
    const key = seriesKey(namespace, pod);
    const series = cluster.series.get(key);
    if (series) {
      series.workload = workload;
      return;
    }
    // The list arrived before the pod's first sample: kept until the series
    // exists, or the rollup would stay missing until the list is loaded again.
    if (!cluster.pendingWorkloads.has(key) && cluster.pendingWorkloads.size >= MAX_PENDING_WORKLOADS) {
      const oldest = cluster.pendingWorkloads.keys().next().value;
      if (oldest !== undefined) cluster.pendingWorkloads.delete(oldest);
    }
    cluster.pendingWorkloads.set(key, workload);
  }

  prune(clusterId: string): void {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) return;
    const now = this.now();
    const cutoff = now - USAGE_RETENTION_MS;
    const fineCutoff = now - USAGE_FINE_RETENTION_MS;

    for (const [key, series] of cluster.series) {
      dropExpired(series.buckets, cutoff);
      // The fine grid expires an hour in, which is what keeps it cheap; the
      // coarse grid still holds the same hour, so nothing is actually lost.
      dropExpired(series.fineBuckets, fineCutoff);
      if (series.buckets.length === 0) cluster.series.delete(key);
    }

    if (cluster.series.size <= MAX_SERIES_PER_CLUSTER) return;
    const ordered = [...cluster.series.entries()].sort(([, left], [, right]) => left.updatedAt - right.updatedAt);
    for (const [key] of ordered.slice(0, cluster.series.size - MAX_SERIES_PER_CLUSTER)) {
      cluster.series.delete(key);
    }
  }

  // The workload is normally learned from a pod list and persisted with the
  // series, so a caller without the pod manifest at hand still gets the
  // rollup; an explicit key wins when the caller does have the manifest.
  history(clusterId: string, namespace: string, pod: string, override?: { key: string; exact: boolean }): UsageHistoryResult {
    const cluster = this.clusters.get(clusterId);
    const windowEnd = this.now();
    const windowStart = windowEnd - USAGE_RETENTION_MS;
    const own = cluster?.series.get(seriesKey(namespace, pod));
    const workloadKey = override?.key || own?.workload || "";
    const workloadExact = override?.key ? override.exact : Boolean(own?.workload);
    const siblings = workloadKey && cluster ? [...cluster.series.values()].filter((series) => series.namespace === namespace && series.workload === workloadKey) : [];

    const points = pointsFrom(own?.buckets, windowStart);
    const finePoints = pointsFrom(own?.fineBuckets, windowEnd - USAGE_FINE_RETENTION_MS);

    return {
      finePoints,
      fineBucketMs: USAGE_FINE_BUCKET_MS,
      fineRetentionMs: USAGE_FINE_RETENTION_MS,
      pod: own ? aggregate([own], windowStart, windowEnd) : null,
      workload: siblings.length ? aggregate(siblings, windowStart, windowEnd) : null,
      workloadKey,
      workloadExact,
      workloadPods: siblings.length,
      points,
      bucketMs: USAGE_BUCKET_MS,
      retentionMs: USAGE_RETENTION_MS,
    };
  }

  // The table reads `kubectl top` once per list load, while sampling continues
  // in the background, so a pod that metrics-server started reporting after
  // that load has a recorded value the table does not. `maxAgeMs` keeps this
  // from resurrecting a reading for a pod that stopped reporting entirely.
  latestSample(clusterId: string, namespace: string, pod: string, maxAgeMs: number): { cpuMillicores: number | null; memoryBytes: number | null } | null {
    const series = this.clusters.get(clusterId)?.series.get(seriesKey(namespace, pod));
    if (!series || this.now() - series.updatedAt > maxAgeMs) return null;
    // The fine bucket holds the newest reading rather than a five-minute
    // average of it, which is what a table column claiming "current" wants.
    const bucket = series.fineBuckets.at(-1) ?? series.buckets.at(-1);
    if (!bucket || bucket.samples === 0) return null;
    return {
      cpuMillicores: bucket.cpuSamples > 0 ? bucket.cpuSum / bucket.cpuSamples : null,
      memoryBytes: bucket.memorySamples > 0 ? bucket.memorySum / bucket.memorySamples : null,
    };
  }

  // Every pod in scope with a recent reading. Serves the table, which would
  // otherwise keep whatever usage its last list load happened to catch.
  recentSamples(clusterId: string, namespace: string, maxAgeMs: number): Array<{ namespace: string; pod: string; cpuMillicores: number | null; memoryBytes: number | null }> {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) return [];
    const cutoff = this.now() - maxAgeMs;
    const entries: Array<{ namespace: string; pod: string; cpuMillicores: number | null; memoryBytes: number | null }> = [];
    for (const series of cluster.series.values()) {
      if (namespace !== "all" && series.namespace !== namespace) continue;
      if (series.updatedAt < cutoff) continue;
      const bucket = series.fineBuckets.at(-1) ?? series.buckets.at(-1);
      if (!bucket || bucket.samples === 0) continue;
      entries.push({
        namespace: series.namespace,
        pod: series.pod,
        cpuMillicores: bucket.cpuSamples > 0 ? bucket.cpuSum / bucket.cpuSamples : null,
        memoryBytes: bucket.memorySamples > 0 ? bucket.memorySum / bucket.memorySamples : null,
      });
    }
    return entries;
  }

  clearCluster(clusterId: string): void {
    this.clusters.delete(clusterId);
  }

  seriesCount(clusterId: string): number {
    return this.clusters.get(clusterId)?.series.size ?? 0;
  }
}
