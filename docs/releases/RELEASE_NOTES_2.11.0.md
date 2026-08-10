# KubeDeck 2.11.0 release notes

KubeDeck 2.11.0 fixes two user-reported bugs and reworks how clusters are
switched. Implementation details and verification are recorded in
`docs/cluster-rail-scope-kubeconfig-2.11.0-plan.md`.

## Bug fix: the resource table kept the previous namespace

Selecting a single namespace and then switching to `All namespaces` could
leave the table showing exactly the rows of the previous namespace, with no
error and no loading indicator.

Rows were keyed by resource name only, so nothing tied them to the namespace
selection they came from; every load aborted the previous one; and the abort
branch returned without touching the rows. On a busy cluster the watch stream
for all namespaces restarted the wide `kubectl get ... -A` faster than it
could finish, so the stale rows stayed on screen indefinitely.

Rows now carry the scope (`cluster`, `resource`, `namespace selection`) they
were loaded for and are dropped before the request is awaited whenever that
scope changes, so an aborted or failed load can only ever leave an empty
table. A silent watch-driven refresh no longer aborts a running load of the
same scope: those events coalesce into a single trailing refresh once the
load finishes. Manual refresh and scope changes still supersede a running
load.

## Bug fix: the running Windows app showed the Electron icon

The portable artifact carried the KubeDeck icon while the running
application showed the default Electron icon in the window, taskbar and
Alt+Tab.

Three independent causes were fixed: the window was created without an icon,
`assets/` was not part of the packaged payload, and `signAndEditExecutable:
false` disabled the rcedit pass that writes icon and version info into the
packaged executable. In addition, the app now sets the `dev.kubedeck.app`
AppUserModelID on Windows, which taskbar grouping and pinning depend on.

## Cluster switching moved to an icon rail

Clusters are now switched from a vertical rail of icon buttons left of the
resource navigation, instead of the dropdown in the topbar. The rail shows
one button per cluster in the configured order, marks the active, opening and
unavailable cluster, supports arrow-key navigation and carries the kubeconfig
import button. Switching still goes through the unsaved-YAML guard. Renaming,
reordering and removing clusters remain in Settings.

## Cluster kubeconfig editing

Settings → Clusters can now open the kubeconfig of a cluster in a YAML editor
and save it back, so a changed API server address, context or user no longer
requires re-importing the file.

The content is validated as a kubeconfig before anything is written, the
previous version is kept next to the file as `.bak`, and saving requires
typing the cluster name. Writes are limited to 1 MiB, are atomic, keep `0600`
permissions and are refused for kubeconfig files outside the KubeDeck
directory. Because the API server or context may have moved, a successful
save stops the cluster's watch, port-forward, terminal and SSH sessions and
clears its caches. The file content is never logged, never recorded in the
audit trail, never written to persisted UI state and never sent to the LLM.

## Release contract

Two new routes: `GET` and `PUT /clusters/{cluster_id}/kubeconfig`. Node-only
ownership moves to Node 56 / Python 0.
