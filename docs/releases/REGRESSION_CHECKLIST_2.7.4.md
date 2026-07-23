# KubeDeck 2.7.4 regression checklist

- [ ] Verify resource actions remain visible in the drawer header across Summary, YAML, Describe, Related, Logs, LLM, Secret, and SSH.
- [ ] Verify Copy resource name writes only `metadata.name` and reports success only after a successful clipboard write.
- [ ] Verify the local Events tab is absent and legacy saved Events tabs open Summary.
- [ ] Verify Pod Summary is concise for healthy pods and shows container failure details plus recent Warning events for unhealthy pods.
- [ ] Verify Secret Summary exposes key names/count only and never values.
- [ ] Verify Columns is icon-only and the permanent resource-table Refresh button is absent.
- [ ] Verify Phase filtering and sorting use Pending, Running, Succeeded, Failed, Terminating, and Unknown while detailed reasons remain available on hover/focus.
- [ ] Verify Pod Terminal icon actions, PTY/pipes status, compact tabs, switching, closing, collapse, and reconnect.
- [ ] Verify watch reconnect, polling fallback, action refresh, unavailable-cluster Retry, and LLM compatibility.
- [ ] Verify Node-only runtime ownership reports Node 51 / Python 0.
- [ ] Repeat the UI smoke in every theme on macOS and Windows production builds.
