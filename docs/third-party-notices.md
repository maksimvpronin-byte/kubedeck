# KubeDeck third-party notices

KubeDeck is licensed under the Apache License, Version 2.0. See `LICENSE` and
`NOTICE` in the repository root.

This document lists the third-party components redistributed inside a packaged
KubeDeck build. Development-only tooling — TypeScript, Vite, Biome,
electron-builder, test helpers and type definitions — is not redistributed and
is therefore not listed here.

The versions below were verified against the committed `package-lock.json` for
KubeDeck 2.12.0. Update this document whenever a production dependency is
added, removed or upgraded.

## Runtime platform

| Component | Version | License |
|---|---|---|
| Electron | 43.1.0 | MIT |

Electron itself bundles Chromium and Node.js. Their license texts are shipped
inside the packaged application in `LICENSE.electron.txt` and
`LICENSES.chromium.html`, as produced by electron-builder. KubeDeck does not
modify those files.

## Direct production dependencies

| Component | Version | License |
|---|---|---|
| `diff` | 9.0.0 | BSD-3-Clause |
| `node-pty` | 1.1.0 | MIT |
| `ssh2` | 1.17.0 | MIT |
| `ws` | 8.21.0 | MIT |
| `yaml` | 2.8.4 | ISC |

## Transitive production dependencies

| Component | Version | License | Required by |
|---|---|---|---|
| `asn1` | 0.2.6 | MIT | `ssh2` |
| `bcrypt-pbkdf` | 1.0.2 | BSD-3-Clause | `ssh2` |
| `buildcheck` | 0.0.7 | MIT | `cpu-features` |
| `cpu-features` | 0.0.10 | MIT | `ssh2` |
| `nan` | 2.27.0 | MIT | `ssh2`, `cpu-features` |
| `node-addon-api` | 7.1.1 | MIT | `node-pty` |
| `safer-buffer` | 2.1.2 | MIT | `asn1` |
| `tweetnacl` | 0.14.5 | Unlicense | `bcrypt-pbkdf` |

## Renderer dependencies

These packages are bundled into the renderer output by Vite rather than shipped
as separate `node_modules` entries.

| Component | Version | License |
|---|---|---|
| `@xterm/addon-fit` | 0.11.0 | MIT |
| `@xterm/xterm` | 6.0.0 | MIT |
| `lucide-react` | 0.468.0 | ISC |
| `react` | 18.3.1 | MIT |
| `react-dom` | 18.3.1 | MIT |

## Not redistributed

- **`kubectl`.** KubeDeck does not bundle `kubectl`. It executes the binary
  already installed on the user's system and distributes no part of it. The
  release gate asserts that no `kubectl` binary is present in the payload.
- **Kubernetes.** KubeDeck is not affiliated with, endorsed by or sponsored by
  the Cloud Native Computing Foundation or The Linux Foundation. Kubernetes is
  a registered trademark of The Linux Foundation and is used here only to
  describe compatibility.
