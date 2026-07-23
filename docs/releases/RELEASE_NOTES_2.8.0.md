# KubeDeck 2.8.0

## Resource usage

- Namespaces show compact CPU, RAM and Storage quota bars.
- Pods show CPU and RAM usage relative to effective Pod limits.
- Nodes add asynchronously loaded Disk usage without blocking the resource list.
- Node disk probes are limited to two concurrent requests and cached for 60 seconds.

## YAML

- Full YAML manifests support collapsible maps and sequences.
- Folding is derived from the existing `yaml` parser and never modifies the full draft.
- Manifest Compare preserves aligned rows while groups are collapsed.

## UI stability

- Lazy panels use local loading/error boundaries, so opening SSH or Pod Terminal no longer replaces the whole application shell.
- Active resource and terminal tabs visually join their corresponding drawer/panel without a baseline seam.

## Compatibility

- Existing Kubernetes action, watch, terminal, YAML apply and Node-only Gateway contracts remain unchanged.
- Runtime ownership remains Node 51 / Python 0.
