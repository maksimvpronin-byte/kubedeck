# KubeDeck 2.12.0 release notes

KubeDeck 2.12.0 adds usage history: KubeDeck now records what pods actually
consume over time and shows it in the pod summary, so a request or a limit can
be judged against measured behaviour instead of a single instantaneous reading.
The recorded numbers are also handed to the LLM analysis.

One new operation on an existing route (`GET
/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/usage-history`).
Node-only ownership stays at Node 56 / Python 0.

## Usage history for pods

Until now the only usage figure available was the current one: `kubectl top`
at the moment the table was loaded. That answers "is it busy right now" and
nothing else, and in particular it cannot answer the question that actually
matters when writing a manifest — whether the request and the limit are set to
sensible values.

KubeDeck now keeps its own history. There is no Prometheus behind it: samples
are taken by KubeDeck itself, which means the history covers the time the
application was running and nothing else. Every figure is therefore presented
together with how much of the window it rests on.

### How it is collected

Two sources, neither of which adds a per-view cost:

- the `kubectl top pods` call the pod table already makes is recorded as it
  passes, so browsing pods fills the history for free;
- a background `kubectl top pods -A` runs once a minute for each cluster you
  have opened, so history keeps accumulating while you work elsewhere in the
  application. Clusters that are configured but never opened are never sampled.

Samples are folded into five-minute buckets holding the average, the peak and
the sample count, kept for 24 hours, and written to
`%APPDATA%/KubeDeck/metrics/<cluster>.json` so a restart does not start from
an empty window. The store is bounded at 2000 series per cluster, evicting the
least recently sampled first, and removing a cluster removes its history with
it.

### Sustained load and peaks are kept apart

This is the distinction the feature exists for:

- **p50 and p95** are percentiles over five-minute averages. That is sustained
  load — what a **request** has to cover, because a request is what the
  scheduler reserves.
- **max** is the highest five-minute peak. That is what a **limit** has to
  survive, because exceeding a CPU limit throttles and exceeding a memory
  limit is an OOMKill.

A pod that idles at 120m and spikes to 900m produces `p50 120m, p95 588m, max
900m` — three numbers that lead to three different conclusions, where a single
current reading leads to none.

### History survives a redeploy

A Deployment's pods are owned by a ReplicaSet whose name carries the
pod-template-hash, and that hash changes on every rollout. Keying history on
the pod or on its ReplicaSet would reset it at each redeploy — exactly when
comparing before and after is most useful.

The hash is therefore removed using the pod's own `pod-template-hash` label,
which recovers the Deployment underneath, so history rolls up to a key that
outlives any individual pod. StatefulSets and DaemonSets own their pods
directly; a CronJob's Jobs are unwrapped the same way as a ReplicaSet.

Replica values are pooled rather than summed: a request is sized per pod, so
adding replicas together would inflate it by the replica count. Window
coverage counts distinct wall-clock slots for the same reason — three replicas
do not make a 20-minute window complete.

### In the summary

The pod Summary tab gains a Usage history section with a bar per five-minute
bucket for CPU and memory: the solid part is the bucket average, the lighter
cap is its peak, and dashed lines mark the request and the limit. The scale
includes the request and limit, so a pod sitting far below its request does
not draw a full bar and look saturated. Above the bars are p50, p95 and max;
above the section is how much of the 24-hour window is actually covered.

A pod with several replicas also gets the same figures across the whole
workload.

### In the LLM analysis

The analysis context gains a `USAGE HISTORY` section with the percentiles, the
peak, the configured request and limit, the workload rollup, and an explicit
note on how to read the percentiles. Coverage is stated first, so a conclusion
drawn from twenty minutes of data is not presented as if it came from a full
day. When nothing has been recorded yet the section says so and instructs the
model not to infer request sizing from absent history — absent data must not
be read as low usage.

## The LLM answered in English

The analysis is meant to be written in Russian, but it arrived in English.
The renderer sent the stored UI language preference, which is `system` by
default; the prompt defined only `ru` and `en`, so `system` matched neither
branch and the model fell back to its own default — English, which the
English-language prompt reinforced.

The answer language is no longer a request field at all. The analysis is
always written in Russian, independent of the interface language, and the
prompt says so directly instead of through a condition that can be fallen
through.

Kubernetes terminology is now explicitly kept in its original form: resource
kinds, phases, statuses and reasons, manifest fields, names of clusters,
namespaces, images and registries, and CLI flags are not translated or
transliterated. Russian is the language of the explanation around those terms,
not of the terms themselves.

This also fixes the English direction, which was broken symmetrically: the
section titles of the rendered answer, the substituted wording for a healthy
pod and the default request were hardcoded Russian, so choosing English
produced an answer with Russian headings.
