# KubeDeck 2.29.0 release notes

KubeDeck talks to the Kubernetes API itself instead of starting kubectl for
every read, keeps the tables it watches in memory, and opens custom resources
that used to time out.

## Reads no longer start kubectl

Every table, every refresh, the usage columns, search, Overview and Problems
each started a kubectl process. On Windows with an antivirus that alone is
hundreds of milliseconds before the request even leaves; a kubeconfig that
signs in through a plugin (kubelogin, EKS, GKE) ran that plugin each time too,
and every request shook hands with the server anew.

- Reads go straight to the API server over one connection per cluster that
  stays open. The sign-in plugin runs once and its credential is reused until
  it expires.
- What KubeDeck understands in a kubeconfig: the current context, client
  certificates, tokens and token files, sign-in plugins, and HTTP proxies from
  the kubeconfig or the environment.
- Anything else - an `auth-provider`, impersonation, a SOCKS proxy - and any
  cluster whose certificate or proxy setup KubeDeck cannot use, keeps going
  through kubectl exactly as before. Errors read the same either way.
- CPU and memory come from the Metrics API directly instead of `kubectl top`.
- Measured on a small k3s cluster on macOS, where starting a process costs the
  least: table lists in 3-4 ms instead of 22-30 ms, search in 18 ms instead of
  159 ms, related resources in 8 ms instead of 95 ms.
- Settings → General → "Read through the Kubernetes API directly" turns this
  off, should a cluster behave differently than with kubectl.

## Watched tables reload from memory

A table watches its resources for changes. Each change used to send it back to
the cluster for the whole list again - on a busy cluster, megabytes every
second or two.

- The watch now keeps the list in memory and applies each change to it; the
  table's reload is answered from there.
- Right after a change made from KubeDeck - a delete, a scale, an apply - the
  table reads from the cluster until the watch has seen it, so it never shows
  the state from before.
- Coming back to a table within a few minutes finds its watch still running.

## Custom resources open

A namespace of Argo CD Applications did not open: the request gave up after 30
seconds. Applications carry their whole resource tree in their status, and
kubectl re-encoded all of it. Custom resources are read straight from their
API path now, like built-in ones.

## Verification

Node-only ownership stays at Node 59 / Python 0, and no route changed.

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **320 tests**, unchanged
- `npm --workspace apps/desktop run test:gateway` - **226 tests**, up from 191:
  a raw GET goes over one kept TLS connection with the kubeconfig's token, gzip
  undone, and never logs it; client certificates from files next to the
  kubeconfig; a server under a path prefix; refusals and an unreachable server
  fail with kubectl's codes and wording; a server Node does not trust, and
  kubeconfigs with unhandled features, go to kubectl and stay there; a
  cancelled or oversized read stops; a kubeconfig proxy is tunnelled through
  CONNECT, a proxy that hangs up without answering hands the read to kubectl at
  once, and NO_PROXY CIDR ranges are honoured; an exec plugin runs once for
  concurrent requests, is renewed before expiry and after a 401, and a failing
  one leaves the read to kubectl; `get -o json` of built-in and custom types is
  one GET, short names and unserved paths go to kubectl; `api-resources` from
  aggregated discovery parses as kubectl's table; node and pod usage from the
  Metrics API; Argo CD Applications listed through their group's discovery; a
  watch over the API applies events, resumes from the last resourceVersion,
  relists after a 410, ends on a refusal, answers each namespace from an
  all-namespaces watch, falls back to kubectl, stops when idle, and stays off
  memory right after a change; the list route answers a watched scope with no
  request to the cluster
- Run against a live k3s 1.35 cluster: `npm run smoke:cluster` in both modes;
  watch events applied in memory, the list matching `kubectl get` by
  resourceVersion, Metrics API usage matching `kubectl top`, no kubectl process
  for any read
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.29.0`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.29.0.md](./REGRESSION_CHECKLIST_2.29.0.md).
