# KubeDeck 2.12.1 release notes

KubeDeck 2.12.1 fixes the pod Usage column, which froze at whatever the table
happened to catch when it was last loaded.

Adds `GET /clusters/{cluster_id}/pod-usage`. Node-only ownership moves to
Node 57 / Python 0.

## The Usage column showed N/A for a pod that had usage

A newly created pod showed `N/A` for CPU and RAM in the Pods table and kept
showing it, while the drawer for the very same pod showed recorded readings a
few centimetres to the right.

Three separate causes, all now fixed.

### A reading of zero was discarded

The usage store decided whether a metric was present by testing its sum
against zero. An idle pod genuinely reports `0m` CPU, so a pod doing nothing
had no CPU history at all: empty percentiles in the drawer, nothing to fill
the table with.

CPU and memory now carry their own sample counts, so presence is a count and
never a value. That also corrects their averages. metrics-server reports
memory from its first scrape but needs two scrapes before it can derive a CPU
rate, so a five-minute bucket can legitimately hold more memory readings than
CPU ones; dividing both by the shared sample count deflated whichever metric
arrived late. History files written before this carry neither count and are
migrated when they are loaded.

### The reported window was wider than what was observed

The window was measured between bucket starts, which round down to five
minutes, so a pod observed for 90 seconds was described as "5 min recorded".
It now comes from real sample timestamps.

### The column never refreshed

The table is driven by watch events, and a pod that has settled produces
none, so the list was not reloaded and the Usage column kept the values from
the load that first showed the pod — for a pod created seconds earlier, no
values at all. The age column ticks live because it is computed in the
renderer, which made the row look fresher than its data.

`GET /clusters/{cluster_id}/pod-usage` returns current usage for the pods in
scope, read entirely from samples KubeDeck has already recorded. It runs no
kubectl command at all, so the table can refresh its numbers every 30 seconds
without paying for the `kubectl get pods` half of a list reload — which is
what the move from polling to watch in 2.11.x was protecting.

A row whose usage is unchanged is left as the same object, so a refresh that
changes nothing does not re-render the table.

## Usage recorded after a list load now reaches the table

Related to the same problem: the table reads `kubectl top` once per list load
while sampling continues in the background, so a pod metrics-server started
reporting after that load had a recorded value the table did not have. A row
the list call returned no metric for is now filled from the most recent
recorded sample, and only if that sample is under two minutes old, so a pod
that stopped reporting goes back to blank instead of keeping its last reading
forever.

## Recorded usage is written before the teardown that can fail

Usage history was flushed to disk last in the shutdown chain, after four
awaited closes for SSH, terminal, port-forward and watch sessions. Any of
those rejecting would skip the write and cost every sample taken since the
last periodic flush. Persisting recorded data does not depend on that teardown
succeeding, so it now runs first.

## The usage history panel refreshes itself

The drawer panel fetched history once when the tab was opened and never again,
because none of its dependencies change over time. A pod whose first samples
arrived after the drawer was opened kept showing "no samples recorded yet"
until the drawer was closed and reopened. It now re-reads every 30 seconds
while the tab is open.

Sampling also moves from 60 to 30 seconds, so the panel and the sampler run at
the same cadence and the first bar appears sooner. metrics-server scrapes
kubelets every 15 seconds by default, so sampling faster than that would only
record the same scrape twice.
