# KubeDeck 2.32.3 regression checklist

2.32.3 shows a pod's init containers and reads their logs. Node-only ownership
is unchanged at Node 60 / Python 0, and no route changed.

The 2.32.2 checklist and the earlier ones still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (340 tests)
- [x] `npm --workspace apps/desktop run test:gateway` (239 tests)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.32.3`
- [x] `/migration/status` remains `node-only`, Node 60 / Python 0

## Init containers

- [ ] A pod whose init container fails (`command: ["sh", "-c", "echo boom; exit 1"]`):
  the Logs tab opens on the init container and shows `boom`; the container
  list has it marked *(init)*.
- [ ] The same pod's row: a red `init <name>` cube in Containers, Restarts
  counting the init restarts, the reason naming the init container.
- [ ] The Summary tab lists the init container first.
- [ ] A pod whose init container completes: the Logs tab opens on the regular
  container; the Containers cell shows only the regular containers; the init
  container's log can still be picked from the list.
- [ ] A pod with a native sidecar (`restartPolicy: Always` in initContainers):
  the Logs tab does not open on the sidecar once the pod is running.
- [ ] A logs request that fails (pick *Previous* on a container that never
  restarted): the error is shown and no Describe text is left in the tab.
- [ ] The terminal still offers only the regular containers.

## Updates

- [ ] An installed 2.32.2: Check for updates shows 2.32.3 with these notes and
  without their Verification section.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.32.2 installer build offers 2.32.3 and installs it without the wizard.
- [ ] Help and About report **2.32.3**.
