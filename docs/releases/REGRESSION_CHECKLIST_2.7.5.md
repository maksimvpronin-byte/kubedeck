# KubeDeck 2.7.5 regression checklist

- [ ] Verify Manifest Compare uses the themed chooser and never opens a native operating-system select.
- [ ] Verify target labels distinguish resources across clusters and namespaces, including long names.
- [ ] Verify mouse selection, Arrow keys, Home/End, Enter, Space, Escape, outside click, and focus return.
- [ ] Verify empty, loading, error, and rapid target-switching states do not show stale YAML.
- [ ] Verify Clean/Raw still rebuilds the diff without reloading the target manifest.
- [ ] Verify Pod Terminal Container and Shell selectors retain their existing behavior.
- [ ] Verify long ResourceQuota names, exact used/hard values, progress bars, and percentages never overlap at minimum and maximum drawer widths.
- [ ] Verify ResourceQuota warning/danger thresholds and sorting are unchanged.
- [ ] Verify LLM status, preview, and analysis remain compatible and never include Kubernetes logs or Secret values.
- [ ] Verify Node-only runtime ownership reports Node 51 / Python 0.
- [ ] Repeat the UI smoke in every theme on macOS and Windows production builds.
