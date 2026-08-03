# KubeDeck 2.10.2 release notes

KubeDeck 2.10.2 is an internal cleanup patch: it removes structural
duplication found during a code audit and fixes one small resulting
correctness bug. There is no new feature, no route/contract change, and no
JSX/behavior change beyond the fix below.

## CPU/memory quantity rounding fix

The backend had two independent Kubernetes quantity parsers: one used by
resource lists (`resources/normalizers.ts`) and one used by node/pod metrics
(`resources/metrics.ts`). The metrics parser already supported the `Pi`/`Ei`
suffixes and truncated its result; the resource-list parser did neither. The
same CPU or memory quantity could therefore round or scale differently
depending on which code path produced it — for example, a `Pi`-suffixed
value would parse correctly in metrics but not in resource list requests/
limits.

Both parsers now live in one `resources/quantity.ts` module, so pod resource
requests/limits and pod/node metrics agree on every input.

## Backend consolidation

- One shared `decodePathPart` (`validation.ts`) replaces 14 byte-identical
  copies across route handlers and WebSocket modules (`ssh/nodeSshWebSocket.ts`,
  `terminal/podTerminalWebSocket.ts`, `watch/webSocket.ts`).
- One shared `writeRouteError` dispatcher (`routes/routeErrors.ts`) replaces
  12 near-identical copies, including three routes that manually rebuilt the
  JSON error body instead of calling the existing `writeError` helper.
  `RouteInfoError` replaces the duplicate `LlmRequestError`/
  `ResourceActionError`/`PodExecError` classes.
- `watch/webSocket.ts` now imports the already-shared `rawDataByteLength`/
  `rawDataText` from `webSocketMessages.ts` instead of a local copy, matching
  the SSH and Pod Terminal WebSocket modules.

No HTTP or WebSocket contract changed; all existing gateway contract tests
pass without modification.

## Renderer consolidation

- `PodDrawer.tsx`'s logs fetch/follow/download state moved into
  `hooks/usePodDrawerLogs.ts`, and its YAML dry-run/apply/reset/reload
  actions moved into `hooks/usePodDrawerYamlActions.ts` — the same
  state-plus-handlers extraction pattern used for `App.tsx` in 2.10.1's
  companion cleanup.
- The byte-identical terminal helpers duplicated between `NodeSshTab.tsx` and
  `TerminalTab.tsx` (`disconnectTerminal`, `terminalStatusClass`,
  `sendTerminalResizeIfChanged`, `fitAndResizeTerminal`,
  `copyTerminalSelection`) now live once in `utils/xtermSession.ts`. The
  xterm construction effects themselves stay per-component, since SSH and Pod
  Terminal genuinely differ there (protocol, Ctrl+C copy handling,
  `convertEol`).
- Removed `components/EventsTab.tsx`, which had zero importers — events are
  shown through `ResourceSummary` and the drawer already redirects away from
  an `"events"` tab.

## Release contract

No route/contract-count change. Node-only ownership stays at Node 54 /
Python 0.
