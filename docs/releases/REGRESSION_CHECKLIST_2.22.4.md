# KubeDeck 2.22.4 regression checklist

2.22.4 changes only how Global Search decides what to score. The results must be
the same, so this checklist is about finding anything the search now misses.

Earlier 2.13.x through 2.22.3 checklists still apply.

## Automated gates

- [ ] `npm run lint`
- [ ] `npm run lint:css`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer` (125 tests, unchanged)
- [ ] `npm --workspace apps/desktop run test:gateway` (165 tests, was 162)
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run verify:release`
- [ ] `/migration/status` remains `node-only`, Node 58 / Python 0

## Nothing is missing from the results

Open the palette with Ctrl+K on a real cluster:

- [ ] Search a pod by its **full name**: it is first in the list.
- [ ] Search by a **name fragment**: the same pods appear as before, in the same
  order.
- [ ] Search by **namespace** name: resources of that namespace appear.
- [ ] Search by a **label value** (for example the value of `app`): the objects
  carrying it appear, and the row says it matched `labels`.
- [ ] Search by an **annotation value**.
- [ ] Search by something that only appears in **status** - a node IP, a pod IP,
  a phase such as `Pending`, a reason such as `ImagePullBackOff`.
- [ ] Search by a **kind**: `Ingress`, `ConfigMap`, `Secret` - resources of that
  kind appear.
- [ ] Search a **CRD by the kind it defines** (for example `IngressRoute`, not
  `CustomResourceDefinition`): the definition appears, and so do its instances
  if the cluster has any.
- [ ] Search a **custom resource instance** by name.
- [ ] Search with **two words** (`nginx ingress`): only rows matching both.
- [ ] Search something that exists nowhere: an empty result, no error.

## Everything else about the palette

- [ ] Ranking is unchanged: exact name first, then partial name, then namespace
  and kind matches.
- [ ] Opening a result still navigates to the right object in the right
  namespace.
- [ ] Partial failures still show: on a cluster where one kind is RBAC-denied,
  the other results appear with the error listed.
- [ ] Typing quickly is responsive, and abandoned searches leave no kubectl
  processes behind (2.22.0).

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Help and About report **2.22.4**.
