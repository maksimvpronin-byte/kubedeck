# KubeDeck 2.32.5 regression checklist

2.32.5 removes the unused `7zip-bin` development dependency and the build-script
code that looked after it. The app itself is unchanged. Node-only ownership is
unchanged at Node 60 / Python 0, and no route changed.

The 2.32.4 checklist and the earlier ones still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (340 tests, also on Node 22.12)
- [x] `npm --workspace apps/desktop run test:gateway` (245 tests, also on Node 22.12)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.32.5`
- [x] `npm audit` reports 0 vulnerabilities
- [x] `npm --workspace apps/desktop run dist:win` builds the Setup and Portable
  executables with no `node_modules/7zip-bin`
- [x] `/migration/status` remains `node-only`, Node 60 / Python 0

## Build

- [ ] After a fresh `npm ci`, `node_modules/7zip-bin` does not exist.
- [ ] Windows: `scripts/build-portable-windows.ps1` runs through *Checking
  native modules* without the 7zip repair step and produces both executables.
- [ ] macOS: `npm run package:mac` on a Mac without `p7zip` builds the dmg and
  the zip.
- [ ] The Release workflow builds all 11 assets.

## Updates

- [ ] An installed 2.32.4: Check for updates shows 2.32.5, downloads it and
  installs it.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.32.4 installer build offers 2.32.5 and installs it without the wizard.
- [ ] Help and About report **2.32.5**.
