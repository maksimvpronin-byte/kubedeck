# KubeDeck 2.20.1 regression checklist

A file move with no behaviour change: `resources/normalizers.ts` became
`resources/normalizers/`, one file per resource family, behind a barrel that
exports exactly what the single file exported. Function bodies were copied, not
edited.

Every row in every resource table is produced by the code that moved, so the
manual pass below is a sweep over the tables rather than a check of one
feature. The automated gates ran and passed during development.

Earlier 2.13.x through 2.20.0 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (93 tests)
- [x] `npm --workspace apps/desktop run test:gateway` (146 tests)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## Every table still fills in

One row is enough per resource; what matters is that the columns carry values
and not blanks.

- [x] **Pods** - Ready, Status, Restarts, Node, IP, Age, CPU and Memory usage.
- [x] A pod in CrashLoopBackOff still shows its restart count and its reason.
- [x] **Deployments**, **StatefulSets**, **DaemonSets**, **ReplicaSets** -
  Ready, Up-to-date, Available, Images, and the condition chips.
- [x] **Jobs** and **CronJobs** - status, completions, schedule, last schedule.
- [x] **Services** - Type, Cluster IP, Ports, Selector, and the **How to reach
  it** section added in 2.20.0.
- [x] **Ingresses** - class, hosts, backend services, routes, addresses.
- [x] **Nodes** - Status, Roles, Labels, Annotations, versions, capacity and
  allocatable for CPU, memory and disk.
- [x] Node labels and annotations still sort by a chosen key (2.18.0/2.19.0).
- [x] **ConfigMaps** and **Secrets** - key count and key names; **no Secret
  value appears anywhere in the row**.
- [x] **PVCs**, **PVs**, **StorageClasses** - status, capacity, access modes,
  class, claim.
- [x] **ServiceAccounts**, **Roles**, **ClusterRoles**, **RoleBindings**,
  **ClusterRoleBindings** - rules and subjects rendered as before.
- [x] **ResourceQuotas** - the usage bars, with used and hard per resource.
- [x] **Events** - type, reason, message, involved object, count, source, and
  the timestamp the list is ordered by.

## The paths that call the normalizers

- [x] **Cluster Overview** fills in and its counts match the tables.
- [x] **Problems** finds the same problems it found in 2.20.0.
- [x] **Global Search** returns rows across resource kinds, and clicking a hit
  opens the right object.
- [x] A **CRD instance** table (any installed CRD) still renders, and its rows
  are still marked as CRD instances with their apiVersion.
- [x] A **watch-driven** update replaces a row in place: delete a pod and watch
  the table update without a manual refresh.
- [x] The **resource drawer** opens from a table row and its Summary agrees
  with the row it came from.

## Nothing else moved

- [x] Pod Terminal, Node SSH and the terminal workspace behave as in 2.20.0.
- [x] Port forwards start, open and stop.
- [x] YAML dry-run and apply, delete/restart/redeploy/scale, and the RBAC-denied
  paths behave as before.
- [x] Run an **LLM** analysis on a pod: the context it builds is assembled from
  a normalized row, so check it still names the pod, its containers and its
  restart reasons - and that no Secret value or log line reaches the prompt.
- [x] Help and About report **2.20.1**.
