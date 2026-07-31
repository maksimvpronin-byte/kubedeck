# KubeDeck 2.9.1 regression checklist

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` contract remains `node-only`, **Node 52 / Python 0**

## Terminal workspace

- [ ] A Pod Terminal opens from the Pod drawer in the bottom workspace.
- [ ] Node SSH opens from the Node drawer in the same bottom workspace.
- [ ] Pod and SSH sessions remain connected while switching resources and workspace tabs.
- [ ] Reopening an existing target activates its existing session instead of creating a duplicate.
- [ ] No more than five combined Pod/SSH sessions can be opened.
- [ ] Closing a tab ends only that session; removing a cluster closes its sessions.
- [ ] Pointer drag changes the workspace and Pod xterm height without selecting page content.
- [ ] Arrow Up/Down resize the focused separator; Shift applies the larger step.
- [ ] Collapse/expand and window resize keep the panel within safe bounds.
- [ ] The saved height is restored and clamped after relaunch.

## Node SSH

- [ ] Password, private-key, agent, and jump-host paths connect when available.
- [ ] Connection controls become a compact target summary during a live session.
- [ ] Hidden SSH terminals resume with correct xterm dimensions when activated.
- [ ] Passwords and passphrases are absent from local persisted UI state, logs, and diagnostics.

## Product regression

- [ ] Cluster import, switching, removal, namespace selection, and resource refresh work.
- [ ] Summary, YAML, Describe, Events, Related, Logs, Secrets, and resource actions work.
- [ ] Port Forward lifecycle and application shutdown cleanup work.
- [ ] English, Russian, themes, Help, and keyboard navigation work.
- [ ] Help displays the packaged 2.9.1 version and current terminal workspace guidance.
- [ ] LLM status, preview, and analysis work without receiving Kubernetes logs.
- [ ] Release payload contains no Python runtime or bundled `kubectl`.
