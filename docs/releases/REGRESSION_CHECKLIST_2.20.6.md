# KubeDeck 2.20.6 regression checklist

The resource table's cells and the Problems panel's classification moved into
their own modules. Same JSX, same rules, no edits to any function body.

Two surfaces, and both are read at a glance rather than clicked through: a
table row and a problem row. The pass below is mostly "look at a row and check
every part of it is still there", which is why it is worth doing on a cluster
with something actually wrong in it - a crash-looping pod, an unschedulable
one, a node under pressure.

Sixteen new behavioural tests now cover the classification rules directly, so
the automated side of this is stronger than it was; what they cannot see is
whether the cell renders.

Earlier 2.13.x through 2.20.5 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (**109 tests**, up from 93)
- [x] `npm --workspace apps/desktop run test:gateway` (146 tests)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## Every cell the table draws

- [x] **Status/phase** - the word, its colour, and the tooltip naming the
  reason. A Running pod that is fully ready has no tooltip; one at 1/2 does.
- [x] A **Pending** pod reads pending, not red; a **CrashLoopBackOff** pod reads
  red.
- [x] **Container cubes** on a pod row: one per container, tooltip naming the
  container, its state, the reason and the restart count. A ready container is
  green; one pulling an image is red; one merely not ready yet is not.
- [x] A pod whose row knows only container names still shows one grey cube each.
- [x] **Age** ticks forward once a second, and a pod older than a day does not
  flicker.
- [x] **Node usage** - CPU, RAM and Disk bars, with the disk one showing `…`
  while it loads and `N/A` when there is none.
- [x] **Namespace usage** - CPU, RAM and Storage against quota, and `No quota`
  where none is set.
- [x] **Pod usage** - the bar against a limit where there is one; against the
  request where there is not, in the soft style, and over 100% when the pod
  exceeds its request; the raw number when neither is set.
- [x] **Workload conditions** on a deployment: the chips, their colours and the
  tooltip with the replica summary.
- [x] **Node labels, roles and annotations** cells, including clicking one to
  filter.
- [x] Sorting by a usage column still offers its metrics and sorts by them.

## The Problems panel

- [x] The summary bar counts, the filters (severity, namespace, kind,
  category), and the table below.
- [x] The **guidance block**: groups of problems with a count each, most severe
  first, at most four.
- [x] The **priority list**: each card names the resource, the reason and the
  next check.
- [x] **Open** a problem that is an Event about a pod: the pod opens, not the
  event.
- [x] **Open** a problem that is the pod itself: the pod opens.
- [x] **Copy** a problem: the clipboard text carries cluster, severity,
  category, resource, reason, message and next check - and names the reporting
  event when it differs from the target.
- [x] A cluster with no problems shows the empty state.
- [x] Resizing the window with the drawer open still reflows the panel by its
  own width (the 2.19.x container-query behaviour).

## Nothing else moved

- [x] Overview, Global Search, the resource drawer, Settings.
- [x] Run an **LLM** analysis on a pod: no Secret value or log line reaches the
  prompt.
- [x] Switch themes and languages.
- [x] Help and About report **2.20.6**.
