# KubeDeck 2.9.0 regression checklist

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `git diff --check`
- [x] Node-only ownership remains Node 52 / Python 0

## Manual smoke

- [ ] A Kubernetes cluster opens on Overview and loads a snapshot.
- [ ] Healthy, transitional, failed and partial states use the correct tone.
- [ ] Problems, Events, Nodes, workloads and namespaces open from Overview.
- [ ] LLM analysis remains local-configured and excludes Kubernetes log streams.
- [ ] Events opens without a duplicate child item.
- [ ] Local activity loads only when opened in Settings.
- [ ] About contains current macOS/Node-only information and consistent buttons.
- [ ] Search and Columns remain on one line.
- [ ] Free workspace closes only a transient drawer and protects dirty YAML.
- [ ] The packaged macOS application launches.
