# KubeDeck 2.20.11 regression checklist

Tests and documentation only. `apps/desktop/src` is byte-identical to 2.20.10,
so there is nothing in the application to look at and the manual pass is the
standard smoke test.

What actually needs verifying is that the SSH test suite still runs everything
it ran before being split into four files.

Earlier 2.13.x through 2.20.10 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (115 tests)
- [x] `npm --workspace apps/desktop run test:gateway` (**154 tests**, the same
  154 as 2.20.10)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## The suite itself

- [x] `npm --workspace apps/desktop run test:gateway` reports **154 passing, 0
  failing**. The count is what matters: a file dropped from the script would
  still show green.
- [x] `tests/node-ssh.contract.test.cjs`,
  `tests/node-ssh-host-keys.contract.test.cjs` and
  `tests/ssh-payload.contract.test.cjs` are all three named in the
  `test:gateway` script and none is skipped.
- [x] `git diff --stat 2.20.10..2.20.11 -- apps/desktop/src` is **empty**.
- [x] Break one SSH assertion on purpose: the suite fails, so the runner really
  is executing the new files.
- [x] No test file in `apps/desktop/tests` is over 700 lines except
  `resource-lists` and `llm`, both listed as exceptions in the plan.

## Standard smoke test

The application is identical to 2.20.10; this is a sanity pass.

- [x] Connect a **cluster**, browse pods, deployments, services and nodes.
- [x] Open a resource drawer and walk its tabs.
- [x] Open a **Node SSH** session - password, and a jump host if you have one -
  and accept a host key prompt. This is the area the tests were rearranged
  around, so it is worth exercising even though its code did not change.
- [x] Open a Pod Terminal.
- [x] Run an **LLM** analysis on a pod: no Secret value or log line reaches the
  prompt.
- [x] Help and About report **2.20.11**.
