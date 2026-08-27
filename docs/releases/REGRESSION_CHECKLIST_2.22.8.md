# KubeDeck 2.22.8 regression checklist

2.22.8 adds a test harness and a dev dependency. No product code changed, so the
application cannot regress from it - what has to be checked is that the build
and the package are untouched by the new dependency.

Earlier 2.13.x through 2.22.7 checklists still apply.

## Automated gates

- [ ] `npm run lint`
- [ ] `npm run lint:css`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer` (138 tests, was 127)
- [ ] `npm --workspace apps/desktop run test:gateway` (166 tests, unchanged)
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run verify:release`
- [ ] `npm run smoke:cluster` against a cluster: all checks pass
- [ ] `/migration/status` remains `node-only`, Node 58 / Python 0

## The dependency stays out of the product

- [ ] `npm audit --omit=dev` reports zero vulnerabilities.
- [ ] `jsdom` appears only under `devDependencies` in
  `apps/desktop/package.json`.
- [ ] `npm run package:win` produces the same portable executable as before,
  within the usual size variation - grep the unpacked `app.asar` for `jsdom` and
  find nothing.
- [ ] The packaged application starts and connects to a cluster.

## The new tests earn their place

- [ ] `npm run test:renderer` finishes in about the same time as before (the DOM
  suites add a second or two, not a minute).
- [ ] Break something on purpose - make the namespace pill also open the drawer,
  or make the selection reset on every refresh - and confirm the DOM suite
  fails. Then undo it.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Help and About report **2.22.8**.
