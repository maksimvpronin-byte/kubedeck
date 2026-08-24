# KubeDeck 2.20.3 regression checklist

Test-suite only. Not one line of `apps/desktop/src` changed in this release, so
there is nothing in the application to look at: the manual pass is the standard
smoke test, not a targeted one.

What did change is how the renderer contract tests are laid out, so the real
verification is that the suite still runs everything it ran before.

Earlier 2.13.x through 2.20.2 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (93 tests, same 93 as 2.20.2)
- [x] `npm --workspace apps/desktop run test:gateway` (146 tests)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## The suite itself

- [x] `npm run test:renderer` reports **93 passing, 0 failing**. The count
  matters more than usual here: a file dropped from the script would still show
  green.
- [x] The twelve files named in `test:renderer` all exist and none is skipped.
- [x] `git diff --stat 2.20.2..2.20.3 -- apps/desktop/src` is **empty**.
- [x] Breaking one test on purpose (change an expected value) makes the suite
  fail, so the runner really is executing the new files.

## Standard smoke test

The application is byte-identical to 2.20.2; this is a sanity pass, not a
targeted one.

- [x] Connect a cluster, browse pods, deployments, services and nodes.
- [x] Open the resource drawer: Summary, YAML, Describe, Events, Related, Logs.
- [x] Global Search and Problems.
- [x] A Pod Terminal and a Node SSH session in the bottom workspace.
- [x] A port forward starts, opens and stops.
- [x] Secret reveal, copy and auto-hide; no value in the audit log.
- [x] Run an **LLM** analysis on a pod: no Secret value or log line reaches the
  prompt.
- [x] Switch themes and languages.
- [x] Help and About report **2.20.3**.
