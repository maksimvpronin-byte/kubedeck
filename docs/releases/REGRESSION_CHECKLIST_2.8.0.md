# KubeDeck 2.8.0 regression checklist

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `git diff --check`
- [x] Node-only ownership remains Node 51 / Python 0

## Manual smoke

- [ ] Namespaces show CPU, RAM and Storage with distinct no-quota/N/A states.
- [ ] Pods show CPU/RAM against limits and keep unbounded Pods honest.
- [ ] Nodes render immediately and load Disk with bounded background work.
- [ ] YAML metadata/spec/status and nested sequences collapse without changing Apply/Dry-run input.
- [ ] Manifest Compare remains aligned after folding and synchronized scrolling.
- [ ] First open of Pod Terminal and Node SSH in a cluster does not flash the whole app shell.
- [ ] Active resource and terminal tabs have no seam with their content surface.
- [ ] LLM analysis still opens and renders without exposing Kubernetes log streams.
- [ ] Light, midnight, nord, forest, plum and mocha themes remain readable.
- [ ] macOS and Windows production builds pass the primary workflows.
