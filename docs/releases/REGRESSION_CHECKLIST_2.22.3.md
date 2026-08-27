# KubeDeck 2.22.3 regression checklist

2.22.3 caches two things every kubectl command used to read from disk: the
application config and the kubectl environment built from a cluster's kubeconfig.
The risk of a cache is staleness, so that is what this checklist looks for.

Earlier 2.13.x through 2.22.2 checklists still apply.

## Automated gates

- [ ] `npm run lint`
- [ ] `npm run lint:css`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer` (125 tests, unchanged)
- [ ] `npm --workspace apps/desktop run test:gateway` (162 tests, was 160)
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run verify:release`
- [ ] `/migration/status` remains `node-only`, Node 58 / Python 0

## Settings must take effect at once

- [ ] Change the **kubectl path** in Settings to an invalid one: the next
  request fails with "kubectl not found", not with the old binary still working.
  Put it back and the next request works again.
- [ ] Change the **auto-refresh interval** and the **restart threshold**: both
  take effect without restarting the application.
- [ ] Change the **theme** and **language**: applied immediately, and still
  applied after a restart.
- [ ] Set and clear an **LLM API key**: status reflects it right away.

## Cluster changes must take effect at once

- [ ] **Rename** a cluster: the rail and the drawer show the new name
  immediately.
- [ ] **Import** a new kubeconfig: the cluster appears and opens.
- [ ] **Remove** a cluster: it disappears and nothing keeps talking to it.
- [ ] **Reorder** clusters: the order sticks and survives a restart.
- [ ] Edit a cluster's kubeconfig through the application (cluster kubeconfig
  editor), pointing at a different server: the next request goes to the new
  server, and there is no proxy-related failure.
- [ ] Edit `%APPDATA%/KubeDeck/config.json` by hand while the application is
  running (change a display name), then trigger any cluster action: the new
  name is picked up.

## Proxy behaviour

Only if a proxy is configured in the environment:

- [ ] With `HTTP_PROXY`/`HTTPS_PROXY` set, a cluster on a private address still
  connects - `NO_PROXY` still carries loopback, the private ranges and the API
  server host of the kubeconfig.
- [ ] Open a Pod Terminal and a Node SSH session: both still work, with their
  own `PATH` intact.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Help and About report **2.22.3**.
