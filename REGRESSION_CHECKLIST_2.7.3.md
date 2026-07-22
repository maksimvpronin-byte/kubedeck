# KubeDeck 2.7.3 regression checklist

- [ ] Compare two long manifests and scroll both panes to their final lines.
- [ ] Verify horizontal scrolling with a long unwrapped YAML line.
- [ ] Verify the Clean/Raw control in every theme.
- [ ] Verify Same, Changed, Added, and Removed line highlighting and line numbers.
- [ ] Reveal a text Secret, edit it immediately, cancel, then save through the in-app confirmation.
- [ ] Verify that immutable and binary-like Secret values remain read-only.
- [ ] Verify that Secret values never appear in confirmation text, logs, audit, or command previews.
- [ ] Verify unavailable-cluster isolation and switching to another healthy cluster.
- [ ] Verify the LLM panel remains compatible and does not include Kubernetes log streams.
- [ ] Verify Node-only runtime ownership reports Node 51 / Python 0.
- [ ] Repeat the UI smoke on macOS and Windows production builds.
