# KubeDeck 2.24.0 regression checklist

2.24.0 changes how KubeDeck is built and delivered rather than what it does.
Node-only ownership is unchanged at Node 59 / Python 0, no route moved, and no
screen was redesigned - so the standard smoke below is a guard against
collateral damage, and the sections above it are the release.

**Unticked boxes below are not oversights.** The automated gates ran; the manual
pass has not. Two of these cannot be ticked at all until 2.24.1 exists, and they
say so.

Earlier 2.13.x through 2.23.7 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css` - the ratchet is 0
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm --workspace apps/desktop run test:gateway` (173 tests, up from 170)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.24.0`
- [x] All three platforms packaged on GitHub runners; the payload check passed
  on each, which is the first time the Linux and Windows packages have been
  built anywhere but a developer's own machine
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## The packages, launched

The part no automated check can reach. Each on a machine that did not build it.

- [ ] **macOS**: mount the DMG, drag KubeDeck to Applications, launch it.
  Gatekeeper asks the ordinary question - "unidentified developer", with Open
  Anyway behind it in Privacy & Security. It must **not** say the application is
  damaged; that is what an unsigned arm64 bundle produces and what the ad-hoc
  signature exists to prevent.
- [ ] **Windows**: run `KubeDeck-Setup-2.24.0-x64.exe`, choose a directory,
  install, launch from the Start menu. The window, taskbar and Alt+Tab icons are
  KubeDeck's.
- [ ] **Windows**: run `KubeDeck-Portable-2.24.0-x64.exe` on a machine with no
  installation, and confirm the two do not interfere.
- [ ] **Linux**: `chmod +x` the AppImage and run it. This package has never been
  built before this release, let alone started.

## About, Updates

- [ ] The card is there, and **Check for updates** does something within a few
  seconds rather than hanging.
- [ ] The **installed** Windows build and the Linux AppImage report "up to
  date" against this release.
- [ ] The **portable** Windows build says it cannot install in place and offers
  the release page; the button opens the browser.
- [ ] The **unsigned macOS** build says the same, for the signature reason, and
  not "up to date".
- [ ] Nothing downloads on its own: watch the network on first open of About.
- [ ] Switch the language to Russian and back; every line in the card is
  translated, and none of them reads `about.update.reason.portable`.
- [ ] Open and close About ten times; no Electron listener-leak warning in
  `%APPDATA%\KubeDeck\logs\desktop.log`.

## Not answerable until 2.24.1

- [ ] An update is actually offered when a newer release exists.
- [ ] **Download** completes, the progress bar moves, and **Restart and
  install** replaces the application rather than leaving it half-written. On
  Windows the gateway must be down before the installer starts, or it will fail
  on files still held open.

## Standard smoke test

Unchanged behaviour, checked because the packaging changed underneath it.

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs, including Logs with follow on.
- [ ] Open a Pod Terminal and a Node SSH session - `node-pty` was rebuilt for
  Electron on each runner rather than on a developer's machine, and this is what
  says the rebuild was the right one.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Help and About report **2.24.0**.
