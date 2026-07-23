# KubeDeck 2.7.6

- Node-only runtime remains active: Node 51 / Python 0.
- Manifest Compare aligns both panes and synchronizes vertical and horizontal scrolling.
- Node lists no longer start one disk metrics command per Node; disk usage loads only for the opened Node Summary.
- Node CPU and RAM use distinct compact resource bars, while Node labels use readable prioritized names.
- Deployment and ReplicaSet rows show simultaneous Kubernetes conditions such as Available, Progressing, and ReplicaFailure.
- ResourceQuota memory and storage values use readable KiB, MiB, GiB, and TiB units.
- Pod Delete uses force deletion by default to remove stuck Pods.
