# KubeDeck 2.7.6 regression checklist

- [ ] Verify Manifest Compare rows align and either pane synchronizes vertical and horizontal scrolling.
- [ ] Verify changing the target or Clean/Raw resets both compare panes to the beginning.
- [ ] Verify a large Node list uses one `kubectl top nodes` command and no per-node disk probes.
- [ ] Verify opening one Node loads disk metrics only for that Node and stale responses are ignored.
- [ ] Verify CPU and RAM bars use distinct colors and retain exact values in accessible tooltips.
- [ ] Verify Node labels prioritize Role, Region, Zone, Type, OS, and Arch and collapse remaining labels into `+N`.
- [ ] Verify Deployment and ReplicaSet show simultaneous Available, Progressing, and ReplicaFailure conditions with reasons.
- [ ] Verify ResourceQuota memory/storage unit thresholds without changing CPU or object-count quantities.
- [ ] Verify Pod Delete confirmation and command preview include `--force --grace-period=0 --wait=false`.
- [ ] Verify non-Pod deletion and Pod Restart do not receive force flags.
- [ ] Verify cluster switching, resource watch, pagination, filtering, sorting, LLM, and Secret redaction remain compatible.
- [ ] Verify Node-only runtime ownership reports Node 51 / Python 0.
- [ ] Repeat the UI smoke in every theme on macOS and Windows production builds.
