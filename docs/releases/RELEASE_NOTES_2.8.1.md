# KubeDeck 2.8.1

## Resource status

- Kubernetes phases use semantic colors: green for healthy, yellow for pending or transitional, and red only for confirmed failures.
- Pod and container status indicators now follow the same state model.

## Resource tables

- Only status values are colored; full rows remain neutral.
- Resource rows and usage bars are more compact.
- Selection checkboxes no longer render stray markers.
- The table footer uses a single separator.

## Branding

- The KubeDeck application icon now uses the new Kube wordmark.

## Compatibility

- Existing Kubernetes actions, watches, terminals, YAML flows and Node-only Gateway contracts remain unchanged.
- Runtime ownership remains Node 51 / Python 0.
