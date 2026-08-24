# KubeDeck 2.21.0 regression checklist

2.21.0 changes what happens between double-clicking KubeDeck and the first
usable window: a boot screen, a window that opens before the gateway is
listening, and a window background taken from the stored theme.

Everything worth checking is in that first second or two, plus the paths that
were quietly relying on the old order.

Earlier 2.13.x through 2.20.11 checklists still apply.

## Automated gates

- [ ] `npm run lint`
- [ ] `npm run lint:css`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer` (123 tests)
- [ ] `npm --workspace apps/desktop run test:gateway` (154 tests, unchanged)
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run verify:release`
- [ ] `/migration/status` remains `node-only`, Node 58 / Python 0

## The screen itself

- [ ] Start KubeDeck. A window with the boot screen appears **immediately** -
  not a blank window, and not a delay before the window.
- [ ] The five stages are shown in order and each one turns from spinner to
  filled dot as it completes: Interface, Local gateway, Settings, kubectl,
  Cluster.
- [ ] The bar only moves forward, and reaches 100% exactly once, at the end.
- [ ] The cluster row shows the cluster's display name once it is known.
- [ ] The screen fades out and the application is fully interactive underneath -
  no leftover overlay, no blocked clicks.

## The estimate

- [ ] Clear `kubedeck.boot.timings.v1` from the renderer's `localStorage` and
  start: **no** estimate is shown next to the percentage.
- [ ] Start again: an estimate is shown, and it is in the region of how long the
  previous start took.
- [ ] Open a cluster that takes several seconds, restart, and confirm the
  Cluster stage now owns visibly more of the bar than it did on a fast start.

## Getting out of the way

- [ ] Start with a cluster that is unreachable (VPN off, or a stale kubeconfig).
  The stage turns red and names the failure, the screen steps aside about a
  second later, and the application shows its own error.
- [ ] Start with a cluster that hangs rather than fails. After ~3 s a "Continue
  in background" button appears and dismisses the screen; left alone, the screen
  hands over on its own ~20 s after the interface stage completed.
- [ ] Start with no clusters configured at all: the screen completes and hands
  over rather than waiting for a cluster that does not exist.

## Language and theme

- [ ] With the UI language set to Russian, restart: the boot screen is in
  Russian, on the first frame, before the application has read any settings.
- [ ] Switch to English, restart: the boot screen is in English.
- [ ] For each theme - Midnight, Nord, Forest, Plum, Mocha, Graphite, Light -
  restart and confirm the window background, the boot screen and the application
  are the same colour. On Light in particular there must be no dark flash.
- [ ] With the theme set to System, restart under a dark and a light OS setting.

## What the new start order could have broken

- [ ] The gateway is reached normally: cluster list, namespaces, resource tables
  and watch-driven updates all work after a start.
- [ ] Quit and start again several times: no stale gateway, no port left
  listening, no "startup failed" dialog.
- [ ] Windows: the taskbar and Alt+Tab icon are still KubeDeck's.
- [ ] macOS: closing the window and reopening from the dock creates a window
  without restarting the gateway.
- [ ] Kill the gateway's start deliberately (for example, make `config.json`
  unreadable): the failure is still reported in a dialog and the application
  quits rather than hanging on the boot screen.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Help and About report **2.21.0**.
