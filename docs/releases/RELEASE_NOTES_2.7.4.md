# KubeDeck 2.7.4

- Node-only runtime remains active: Node 51 / Python 0.
- Resource Summary now shows curated operational health instead of raw Kubernetes metadata.
- Resource actions live in the drawer header, and Copy name copies only `metadata.name`.
- The local Events tab is removed; recent Warning events appear in Summary without Normal event noise.
- Resource tables use compact canonical Phase values, an icon-only Columns control, and no permanent Refresh button.
- Pod Terminal controls and session tabs are compact; persistent kubectl command and shell fallback hints are removed.
