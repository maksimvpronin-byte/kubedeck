# KubeDeck 2.12.0 regression checklist

Automated gates below ran and passed during development, including new tests
pinning the added behaviors (workload key stability across a redeploy, sample
parsing, sustained-versus-peak percentiles, retention and series bounds,
restart recovery, the LLM context section, and the always-Russian answer).
Manual items stay open until someone runs them on a real cluster.

Usage history has not yet been observed against a live `kubectl top`: the
logic is covered by tests, but the first manual pass should confirm the bar
fills as expected over a few hours.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 56 / Python 0**

## Usage history: collection

- [ ] Open a cluster and leave KubeDeck on a non-pod screen for ~15 minutes,
  then open a pod: the Usage history section already has bars.
- [ ] Browse the Pods table: history fills without any additional `kubectl`
  process beyond the one the table already runs.
- [ ] Confirm the background sampler runs about once a minute and only for
  clusters that have been opened this session.
- [ ] A cluster without metrics-server shows no history and produces no
  repeating error in the log.
- [ ] Watch memory and the size of `%APPDATA%/KubeDeck/metrics/<cluster>.json`
  on a large cluster over a few hours: both stay bounded.
- [ ] Restart KubeDeck: history from before the restart is still shown.
- [ ] Remove the cluster: its file under `metrics/` is gone.
- [ ] A gap while the application was closed appears as a gap, and coverage
  drops accordingly rather than being interpolated.

## Usage history: summary

- [ ] A pod with both request and limit shows both dashed markers, and the
  bars are readable against them.
- [ ] A pod with no request and no limit still shows bars scaled to its own
  peak.
- [ ] A pod using far less than its request does not draw a full-height bar.
- [ ] Hovering a bar shows the bucket time, average and peak.
- [ ] p50, p95 and max match what the bars show; p95 is below max for a pod
  with spikes.
- [ ] A freshly created pod shows the "no samples recorded yet" message
  instead of an empty plot.
- [ ] A Deployment with several replicas shows the workload line, and the
  numbers are per-pod rather than the sum of the replicas.
- [ ] Redeploy the Deployment: the workload figures continue across the
  rollout instead of resetting, while the new pod's own history starts fresh.
- [ ] A StatefulSet pod (`db-0`) and a DaemonSet pod roll up to the right
  workload.
- [ ] A bare pod with no owner shows its own history and no workload line.
- [ ] The section stays readable in a narrow drawer and in light, midnight and
  steel-graphite themes.
- [ ] Switching quickly between pods never shows another pod's history.

## LLM analysis

- [ ] Run an analysis with the interface set to Russian: the answer is in
  Russian.
- [ ] Set the interface to English and to System, then run it again: the
  answer is still in Russian.
- [ ] Kubernetes terms are not translated: `Pod`, `Running`,
  `CrashLoopBackOff`, `readinessProbe`, image and namespace names appear in
  their original form inside Russian sentences.
- [ ] The prompt preview contains a `USAGE HISTORY` section with coverage,
  percentiles, peak, and the configured request and limit.
- [ ] Analysing a pod with no recorded history: the section says nothing was
  recorded, and the answer does not claim the pod is under-utilised.
- [ ] Ask about request/limit sizing on a pod with a few hours of history: the
  answer distinguishes sustained load from peaks.
- [ ] The answer still contains no Kubernetes log content.

## Product regression

- [ ] Cluster import, switching, rename, removal and refresh work.
- [ ] Pods, Nodes and Namespaces tables still show their usage columns, and
  the tables do not become slower.
- [ ] Pod Terminal and Node SSH connect, resize and disconnect correctly.
- [ ] Pod Drawer logs and YAML (dry-run, apply, reset, reload) work.
- [ ] Related resources, Global Search, Problems and Port Forward work.
- [ ] Service endpoints still appear in the Service summary.
