# KubeDeck 2.17.0 regression checklist

One new action: running a CronJob by hand. The automated gates below ran and
passed during development, and both the plan the gateway builds and the name
the drawer generates are covered by contract tests.

Earlier 2.13.x, 2.14.0, 2.15.x and 2.16.x checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## Run now

- [ ] Open a CronJob: a **Run now** button sits beside Delete in the drawer
  header.
- [ ] Press it: the confirmation names the CronJob, explains that the schedule
  is untouched, and previews
  `kubectl create job <name>-manual-<seconds> --from=cronjob/<name> -n <ns>`.
- [ ] Cancel: nothing runs.
- [ ] Confirm: the drawer reports the result, and a Job named
  `<cronjob>-manual-<seconds>` appears under **Jobs** within a refresh.
- [ ] Its pod appears under **Pods** and runs the CronJob's container.
- [ ] Press **Run now** twice a few seconds apart: two Jobs are created, with
  different names, and neither fails to be created.
- [ ] The **Schedule** and **Last schedule** on the CronJob's Summary are
  unchanged, and the next scheduled run happens as it would have.
- [ ] Open the CronJob's YAML: nothing about it was modified.
- [ ] **Audit** records `resource.trigger` with the created Job's name.

## When it should not work

- [ ] A CronJob whose name is very long: the generated Job name is at most 63
  characters and the run is still accepted.
- [ ] On a cluster where the kubeconfig user cannot create Jobs: the failure is
  reported as a permission problem, and no Job is created.
- [ ] Open a Deployment, a Job, a Pod and a Node: none of them offers **Run
  now**.
- [ ] Delete a CronJob: unchanged, and the confirmation is the usual one.

## Nothing else moved

- [ ] Restart a pod, redeploy and scale a Deployment, delete a Service: every
  confirmation still previews its own command and still runs.
- [ ] Bulk delete rows from a table, and Cordon / Uncordon / Drain a node.
- [ ] The resource drawer's Summary, YAML, Describe, Related, Events and LLM
  tabs open as before, and the YAML search behaves as in 2.16.0.
- [ ] The pagination bar is still at the bottom of the window, as in 2.16.1.
- [ ] Help and About report **2.17.0**.
