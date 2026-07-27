# KubeDeck 2.9.0

## Cluster Overview

- Overview is the first cluster workspace and summarizes health, problems, workload readiness, capacity, namespace hotspots and recent warning events.
- A single Node Gateway snapshot loads Kubernetes sources concurrently and preserves partial results.
- Overview links directly to Problems, Events, Nodes, workloads and resource drawers.
- Refresh keeps the last snapshot visible and marks unavailable sources honestly.

## Navigation and workflow

- Events opens directly without a duplicate nested Events item.
- Local KubeDeck audit moved from the main sidebar to Settings → Local activity.
- Search and Columns stay together in one compact resource-table toolbar group.
- A transient resource drawer closes when the user clicks free workspace background while pinned tabs, terminals and dirty YAML remain protected.

## About

- About actions now use shared KubeDeck button styles.
- Legacy Python, Windows packaging and internal release checklist content was removed.
- Missing application metadata no longer displays a hard-coded old version.

## Compatibility

- Existing Kubernetes actions, watches, terminals, YAML flows and resource navigation remain available.
- Node-only runtime ownership is Node 52 / Python 0.
