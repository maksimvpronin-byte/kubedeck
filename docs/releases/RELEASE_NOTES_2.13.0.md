# KubeDeck 2.13.0 release notes

KubeDeck 2.13.0 puts the cluster connection under the user's control, and reads
usage at the rate metrics-server actually publishes instead of a rounded table
five times slower.

Adds `POST /clusters/{cluster_id}/disconnect`. Node-only ownership moves to
Node 58 / Python 0.

## Clusters no longer stay connected forever

Every cluster that had been opened left background work behind it: a usage
sampler on a timer and one `kubectl get --watch` process per resource kind being
viewed. None of it stopped when the user moved on, so a session spent across
eight clusters ended with eight samplers and eight sets of watch processes still
running against clusters nobody was looking at. On a machine with many clusters
configured that is a permanent, growing cost for nothing.

The rail now carries the switch.

- Left click connects and opens a cluster, as before.
- Right click opens a menu with **Connect** and **Disconnect**.
- A badge on the corner of the button says which state it is in: green
  connected, grey not connected, red for a cluster that was asked to connect
  and could not. A disconnected cluster also loses its accent colour and most
  of its contrast, so the live ones are findable without reading anything.

The badge is a separate element rather than a ring on the button itself. A ring
lost to the rule that marks the active cluster, which sets its own box-shadow
later in the stylesheet - so the one cluster the user was actually looking at
showed no connection state at all.

Disconnecting releases everything bound to that endpoint - watches, the usage
sampler, port forwards, pod terminals, node SSH, and the cached resource
snapshots - and keeps it released. A resource list load can no longer quietly
restart a sampler for a cluster the user disconnected.

Nothing connects on its own. Importing a kubeconfig adds a cluster without
talking to it, and after a restart only the cluster KubeDeck reopens is
connected.

Starting a watch is refused for a disconnected cluster rather than only being
avoided by the renderer. A watch is a long-lived kubectl process, and a
reconnecting socket or a view that had not caught up could otherwise bring the
cluster back up on its own - which made a disconnect look as though it had
done nothing.

Every route under `/clusters/{id}/...` is refused for a disconnected cluster,
not just the ones someone remembered to gate. Resource lists, actions on them,
pod exec, logs, port forwards, search, problems and overview all answer 409
`CLUSTER_NOT_CONNECTED`. The exceptions are named rather than assumed: `open`
connects, `disconnect` stays idempotent, and the kubeconfig stays editable -
a cluster you cannot reach is exactly the one whose kubeconfig you need to fix.
An unknown cluster id still answers 404 rather than being reported as merely
disconnected.

The workspace follows. A disconnected cluster shows what happened and a Connect
button instead of the rows loaded before the disconnect, and the open drawer is
closed - those rows were stale by definition and every action on them would now
be refused.

Recorded usage history is dropped along with the connection. Keeping it meant
reconnecting showed a full window immediately, which read as proof that the
cluster had never been disconnected. History already lives for one run rather
than being persisted, so it now lives for one connection.

### Live sessions are named before they are closed

Background polling can stop without asking. A port forward cannot: it is a
socket another application is using, and a pod terminal or node SSH session is
somebody's shell. Disconnect refuses the first time when any of those are open
and answers with what it found; the confirmation lists them by kind and count,
and only then closes them. The check and the teardown are the same request, so
nothing can start in the gap between them.

## Usage is sampled the way metrics-server serves it

`kubectl top` renders the Metrics API response as a table: CPU rounded to whole
millicores, and the scrape timestamp dropped. For a pod using 3.47m that
rounding is a seventh of the reading, and it is always downward - worst for
exactly the pods whose request is most oversized.

The sampler now reads `/apis/metrics.k8s.io/v1beta1/pods` directly. Same kubectl,
same kubeconfig, same single request per tick; nanocore precision and a per-pod
scrape timestamp come back with it.

Sampling moves from 30 to 15 seconds to match `--metric-resolution`, which is
what metrics-server defaults to. Polling at that rate means landing on the same
scrape twice, so a reading whose timestamp has already been recorded is
discarded. Without that, a repeated value would count as two measurements and
drag the average toward whichever value happened to repeat.

The resource list no longer feeds its own `kubectl top` reading into the history.
It is rounded and has no timestamp, so it can be neither deduplicated nor
matched against the sampler's precision, and a table on a short auto-refresh
would have contributed more of those rounded points than the sampler contributes
real ones.

## The usage chart moves at 15 seconds

History is kept on two grids. Five-minute buckets cover 24 hours and remain the
only source of every percentile; a second 15-second grid covers the last hour
and exists purely to draw. The panel defaults to the live hour and keeps the full
window one click away.

Keeping them separate is deliberate. Mixing 15-second points for the last hour
with five-minute points for the other 23 would place most of the sample
population inside 4% of the window, and p50/p95 would describe the last hour
rather than the day - which is exactly the number the request/limit verdict rests
on. The percentiles shown next to each chart are labelled as covering the whole
window whichever view is on screen.

A 15-second bucket holds one scrape, so its tooltip reports one number instead of
an average and a maximum that are the same value twice. Five-minute buckets keep
both and now also report how many samples are behind them.

Measured cost at the 2000-pod cap: 118 MB, against 63 MB before.

## Smaller fixes

**Memory readings are shown at the unit a reader thinks in.** `403840Ki` divides
by 1024 evenly, so the formatter kept it in Ki. Magnitude now picks the unit and
exactness only picks the decimals, giving `394.4Mi`; round values still collapse
to `1Mi` and `2Gi`.

**The table and the drawer no longer disagree about the same pod.** Both refresh
every 15 seconds, but each timer started when its component mounted, leaving them
up to a full interval apart - visible as two different numbers for a pod whose
memory was climbing. Both now align to wall-clock boundaries.

**The request/limit verdict answers rather than restates.** The analysis had been
quoting the comparison and stopping there. It now has to end in a judgement and
say what the setting costs. A restart count is judged against the pod's uptime,
so four restarts over 37 days is no longer called frequent. Percentages of a
request are no longer restated as an excess over it, and a thin observation
window is disclosed by KubeDeck itself.
