# KubeDeck 2.9.3 release notes

KubeDeck 2.9.3 combines the planned 2.9.2 visual and packaging fixes with the
new Steel Graphite color theme. The separately planned 2.9.2 artifact is not
released; its completed changes are included here.

## Steel Graphite

- Added Steel Graphite as a persistent dark theme with neutral charcoal
  surfaces and cool blue interaction states.
- Added accessible success, pending, warning, danger, CPU, memory and storage
  colors plus a matching terminal ANSI palette.
- Pod Terminal and Node SSH apply the theme live through the existing CSS token
  and theme-change path without changing PTY, SSH or Gateway protocols.
- Theme selection is restored before the first renderer paint and remains
  compatible with System, Light and the existing dark themes.

## Packaged UI and Capacity

- Repaired the Capacity `Group by` selector and responsive card sizing so group
  names and resource metrics remain readable.
- Restricted packaged renderer navigation to `renderer/index.html`, preventing
  a lazy JavaScript chunk from replacing the application window.
- Retained the resizable shared Terminal Workspace for Pod and Node SSH
  sessions.

## Windows packaging

- Added a committed multi-size Windows ICO and configured electron-builder to
  use it directly.
- Windows Portable packaging no longer converts the 1254×1254 source PNG using
  the WebAssembly icon tool that could fail with an allocation error.
- The expected artifact is `KubeDeck-Portable-2.9.3-x64.exe`.

## Release contract

- Root, desktop, shared-types and lock metadata are synchronized to 2.9.3.
- English and Russian README files, Help runtime versioning, changelog,
  migration status, release notes and regression checks are synchronized.
- The Node-only ownership contract remains **Node 52 / Python 0**.

macOS artifacts are unsigned and not notarized. Windows Portable remains an
unsigned build. This release contains neither a Python runtime nor a bundled
`kubectl`.
