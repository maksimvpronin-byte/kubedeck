# KubeDeck 2.8.1 regression checklist

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

- [x] A Kubernetes cluster connects and loads its resource lists.
- [x] Running and ready states render green.
- [x] Pending and transitional states render yellow.
- [x] Confirmed container failures render red.
- [x] Resource rows remain neutral and compact.
- [x] Selection checkboxes render without stray markers.
- [x] The table footer has one separator.
- [x] LLM analysis opens without exposing Kubernetes log streams.
- [x] The packaged macOS application launches.
