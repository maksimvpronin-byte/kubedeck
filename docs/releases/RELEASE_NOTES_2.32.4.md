# KubeDeck 2.32.4 release notes

A round of fixes from a code review - crashes, secrets reaching places they
should not, statuses that read wrong - and a runtime update that closes the
findings of a Trivy scan of the dependencies.

## Runtime and dependency security

- **Electron 43.1.0 → 43.8.3** (Chromium 150.0.7871.250, Node 24.22.0). The
  same 43 line, with nine Electron CVEs fixed.
- **electron-updater 6.6.2 → 6.8.12.** Its builder-util-runtime 9.7.1 no
  longer forwards `Authorization` or `PRIVATE-TOKEN` headers when a download
  is redirected to another host.
- Build and development tools are updated too - concurrently (`shell-quote`),
  vite, axios, undici and others. None of them ships inside the app. All 71
  findings of the Trivy scan of `package-lock.json` are closed, and
  `npm audit` reports none.

## Secrets stay where they belong

- **LLM analysis** redacts the YAML as a structure, not line by line: an env
  value whose name looks sensitive (`DB_PASSWORD`), a Secret's data under any
  key and the `last-applied-configuration` annotation no longer reach the
  prompt.
- **Secret tab.** A key named `__proto__` survives a save instead of being
  dropped from it; keys like `constructor` no longer take the drawer down; the
  values are read-only while their own save is in flight.
- **YAML apply** refuses a `kind: List` (anything with an `items` array):
  kubectl would have applied every item, past a confirmation that showed one
  object.
- **Settings.** A save that the app refuses puts the previous LLM API key back,
  and the form no longer says *Saved* and clears the key for nothing saved.

## No more crashes of the main process

A malformed request to the local gateway, a proxy password with a stray `%`, a
kubectl command cancelled before it started, a port forward that fails to
spawn, a socket message carrying an object where a number was expected and a
terminal socket erroring while authorization is pending - each of these could
take the app down. Now they are refused or logged.

## Statuses that read right

- **DaemonSets** count their nodes; they used to read 0/0, *Scaled to zero*.
- **Jobs** are finished only when a terminal condition says so: a Job that
  failed once and then succeeded is not failed, and one succeeded pod of a
  parallel Job is not done. **CronJobs** count their running Jobs.
- **Problems** no longer lists a completed Job pod or a cordoned Ready node.
- **Namespace quotas** that overlap are not added together: the tightest
  ceiling applies, and usage is counted once.
- **Native sidecars** (`restartPolicy: Always` init containers) add to the
  pod's requests. A workload scaled to zero is healthy in Overview, not
  pending.
- **Events** of an object recreated under the same name (a StatefulSet's
  `web-0`) are no longer mixed with its predecessor's.

## Leaks and races

- kubectl watches of a namespace or resource left behind are stopped once
  idle, instead of running until disconnect; a watch started during a
  disconnect no longer survives it.
- Pod logs going to a window that stopped reading are bounded; stale cache and
  usage samples are dropped after a clear.
- The resource drawer, the LLM tab and the terminal ignore answers that arrive
  after another object was selected. The terminal's container and shell stay
  locked while it connects. Undo in the YAML editor no longer brings back the
  previous resource's manifest.
- Changing the namespace with an unsaved YAML draft asks first, like any other
  navigation away from it.
- Request timeouts also cover the response body: a server - or an LLM
  provider - that sends headers and then stalls is cut off.

## Also fixed

- Permission checks for exec and for scaling ask kubectl with
  `--subresource`; `deployments/scale` was read as a Deployment named *scale*.
- An imported kubeconfig keeps working with relative certificate and key
  paths: they are made absolute against the file's original folder.
- Resources served only by a non-preferred API version are listed.
- Search ranks every match before it cuts the list: an exact name further down
  is no longer dropped.
- The SSH host-key prompt is not cut off by the connection timeout, and
  multibyte characters split between chunks come through intact.
- Related resources honour `matchExpressions`, find Services by the pod
  template's labels and list ConfigMaps and Secrets of projected volumes.
- A node metadata filter opens the folded groups it matches in.

## Verification

No route changes. Node-only ownership stays at Node 60 / Python 0.

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **340 tests**
- `npm --workspace apps/desktop run test:gateway` - **245 tests**, 6 new
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.32.4`
- `npm audit` - 0 vulnerabilities
- `/migration/status` remains `node-only`, Node 60 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.32.4.md](./REGRESSION_CHECKLIST_2.32.4.md).
