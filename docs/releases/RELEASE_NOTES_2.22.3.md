# KubeDeck 2.22.3 release notes

Preparing a kubectl command stops reading two files from disk. No route changes,
no API change. Node-only ownership stays at Node 58 / Python 0.

Section E of the 2.22.x performance pass -
[perf-audit-2.22.0-plan.md](../perf-audit-2.22.0-plan.md).

## What was happening

Every kubectl invocation goes through `clusterCommand()`, and every one of them
paid the same fixed cost before the process was even spawned:

- `configStore.load()` - `readFileSync` of `config.json`, `JSON.parse`, and a
  full normalize, to find one cluster's kubeconfig path and the kubectl path;
- `kubeconfigServerHost()` - `readFileSync` of the kubeconfig and a regex, to
  find the API server host for `NO_PROXY`;
- `{ ...process.env }` - a copy of the whole process environment to hold two
  proxy variables. `process.env` is a native accessor, not a plain object, so
  this was the most expensive part of the three.

All of it synchronous, on the thread that also serves the gateway and parses
watch events. It adds up wherever commands fan out: the nodes table warms one
kubelet request per node and the renderer then asks for each node again, so a
60-node cluster paid this 120 times.

Measured against the built modules, on a real `ConfigStore` and kubeconfig:

| | before | after |
|---|---|---|
| `clusterCommand()` | 0.342 ms | **0.014 ms** |
| 60-node table, 120 commands | 41.1 ms | **1.7 ms** |

## What it does now

Both reads are cached and validated against the file's own stamp - modification
time and size - so nothing has to be trusted for longer than the file stays put:

- **`ConfigStore`** keeps the normalized config and drops it in `save()`, which
  covers this process; the stamp check covers a second instance or a
  hand-edited file. Callers still get their own copy, because `updateSettings`
  and the cluster mutations write into what `load()` returns before saving it.
- **`kubectlEnvironment`** keeps the built environment per kubeconfig path, and
  rebuilds it when the kubeconfig changes, when it appears or disappears, or
  when the proxy settings of the process itself change - reading those two
  variables costs nothing next to copying the environment they live in. The
  environment is shared rather than copied per command: it goes straight into
  `spawn`, and the one caller that needs a different `PATH` (the pod terminal)
  already builds its own object from it.

Only a change to the process environment beyond `NO_PROXY`/`no_proxy` is outside
what the cache can notice. That is fixed at start-up in the application;
`clearKubectlEnvironmentCache()` exists for tests that change it.

## Files

| File | |
|---|---|
| `apps/desktop/src/main/backend/config/configStore.ts` | stamp-validated config cache, dropped on save |
| `apps/desktop/src/main/backend/kubectl/command.ts` | environment cache per kubeconfig, `clearKubectlEnvironmentCache` |
| `apps/desktop/tests/gateway.contract.test.cjs` | 2 new tests: an external edit is still seen, a rewritten kubeconfig rebuilds `NO_PROXY` |

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **125 tests**, unchanged
- `npm --workspace apps/desktop run test:gateway` - **162 tests** (was 160)
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- `/migration/status` remains `node-only`, Node 58 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.22.3.md](./REGRESSION_CHECKLIST_2.22.3.md).
