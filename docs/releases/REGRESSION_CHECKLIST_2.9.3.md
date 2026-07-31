# KubeDeck 2.9.3 regression checklist

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway` — 83/83 tests
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 52 / Python 0**

## Steel Graphite

- [ ] Steel Graphite is selectable in Settings in English and Russian.
- [ ] The selection applies immediately and survives application restart.
- [ ] Resource tables keep readable normal, hover, selected and focused rows.
- [ ] Success, pending, warning and danger remain visually distinct.
- [ ] Capacity CPU, memory and storage rings and values remain readable.
- [ ] Pod Terminal and Node SSH update colors without reconnecting or clearing
  scrollback.
- [ ] System, Light, Midnight Blue and the other existing themes have no
  regressions.

## Visual and packaged UI fixes

- [ ] Capacity `Group by` is a full-width themed selector and does not duplicate
  its selected label.
- [ ] Capacity cards show labels and values without overlap at one, two and
  three columns.
- [ ] Resizing the Terminal Workspace changes the visible xterm height for Pod
  and Node SSH sessions.
- [ ] A packaged application stays on `renderer/index.html`; lazy chunks cannot
  replace the window with minified JavaScript.

## Packaging

- [ ] Help displays packaged version 2.9.3.
- [ ] Windows produces `KubeDeck-Portable-2.9.3-x64.exe` without running the
  PNG-to-ICO WebAssembly conversion.
- [ ] macOS produces `KubeDeck-2.9.3-arm64.dmg` and
  `KubeDeck-2.9.3-arm64.zip`.
- [ ] The release payload contains neither Python runtime nor bundled `kubectl`.

## Product regression

- [ ] Cluster import, switching, removal, namespace selection and refresh work.
- [ ] Summary, YAML, Describe, Events, Related, Logs, Secrets and actions work.
- [ ] Pod Terminal, Node SSH, Port Forward and shutdown cleanup work.
- [ ] Keyboard navigation and focus-visible states remain usable.
- [ ] LLM status, preview and analysis work without receiving Kubernetes logs.
