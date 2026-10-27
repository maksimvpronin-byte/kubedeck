# KubeDeck 2.32.4 regression checklist

2.32.4 carries the fixes of a code review round and moves the runtime to
Electron 43.8.3 with electron-updater 6.8.12. Node-only ownership is unchanged
at Node 60 / Python 0, and no route changed.

The 2.32.3 checklist and the earlier ones still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (340 tests, also on Node 22.12)
- [x] `npm --workspace apps/desktop run test:gateway` (245 tests, also on Node 22.12)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.32.4`
- [x] `npm audit` reports 0 vulnerabilities
- [x] `/migration/status` remains `node-only`, Node 60 / Python 0

## Runtime

- [ ] About shows Electron 43.8.3; the Pod Terminal and Node SSH open
  (node-pty and ssh2 load under the new runtime).

## Secrets

- [ ] LLM analysis of a pod with `env: [{name: DB_PASSWORD, value: hunter2}]`:
  the value does not reach the prompt.
- [ ] A Secret with a key `__proto__`: edit another key and save; the
  `__proto__` key is still there afterwards.
- [ ] A Secret with a key `constructor`: the Secret tab opens and shows it.
- [ ] YAML apply of a `kind: List` with two ConfigMaps is refused with
  "one object at a time".
- [ ] Settings: type a new API key together with a kubectl path that does not
  exist and save; the form shows the error, does not say *Saved*, and the
  previously saved key still works.

## Statuses

- [ ] A DaemonSet shows its nodes (`3/3`), not *Scaled to zero*.
- [ ] A Job with `backoffLimit: 2` that fails once and then succeeds reads
  *Complete*; a CronJob with a running Job shows it as active.
- [ ] Problems: a completed Job pod and a cordoned Ready node are not listed.
- [ ] A namespace with two ResourceQuotas: the usage cell shows the tighter
  limit, not the sum.
- [ ] Overview: a Deployment scaled to 0 is healthy.

## Leaks and races

- [ ] Browse several namespaces and resources, wait two minutes: kubectl
  watch processes of the scopes left behind are gone (Task Manager / `ps`).
- [ ] Open a Pod drawer, start an LLM analysis, select another pod: the answer
  does not land on the second pod.
- [ ] Edit YAML in a drawer, change the namespace: the app asks before the
  draft is dropped.
- [ ] Open the YAML of one resource, then another, press Ctrl+Z: the first
  manifest does not come back.

## Also

- [ ] Scale a Deployment as a user allowed `deployments/scale`: the permission
  check passes.
- [ ] Import a kubeconfig whose `certificate-authority` is a relative path:
  the cluster connects.
- [ ] Global search for an exact pod name in a large namespace finds it.
- [ ] Node SSH to an unknown host: the host-key prompt waits for the answer
  past the connection timeout.

## Updates

- [ ] An installed 2.32.3: Check for updates shows 2.32.4 with these notes and
  without their Verification section, downloads it and installs it.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.32.3 installer build offers 2.32.4 and installs it without the wizard.
- [ ] Help and About report **2.32.4**.
