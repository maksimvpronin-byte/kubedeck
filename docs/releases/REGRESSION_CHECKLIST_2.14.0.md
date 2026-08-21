# KubeDeck 2.14.0 regression checklist

Automated gates below ran and passed during development, including a test that
drives the watch refresh coalescer through both the storming and the starving
event rates.

Earlier 2.13.x checklists still apply; nothing in them was superseded. This
release changes no behaviour except the timing of watch-driven refreshes, so
the manual checks below are mostly about confirming that everything still
updates when it should.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## Watch-driven refresh

- [ ] Open Pods on a quiet cluster, delete a pod from a terminal: the table
  drops the row about a third of a second later, as before.
- [ ] Open a busy namespace, or the Events resource on a busy cluster, and
  leave it: the table keeps updating and never freezes. Watch Diagnostics shows
  the watch healthy throughout.
- [ ] With that busy view open, watch the kubectl processes: reloads are
  seconds apart, not back to back.
- [ ] Switch namespace while events are arriving: the new scope loads at once
  rather than waiting out the previous burst.
- [ ] Set the auto-refresh interval to 10s and disconnect the watch (stop the
  cluster's watch from Watch Diagnostics): polling takes over as before.

## Resource table

- [ ] The Age column advances once a second for a pod created minutes ago, and
  reads correctly for pods days old.
- [ ] A row with no valid creation timestamp shows the raw value, not a
  computed age.
- [ ] Sort every column of Pods and Nodes, ascending and descending: the order
  matches what 2.13.4 produced, including the numeric parts of names.
- [ ] Type in the filter box of a large table: the field keeps up with typing.
- [ ] Open a CRD instance tab and a resource with no dedicated columns: filter,
  sort and pagination all work.
- [ ] Select rows, change page and change page size: the selection follows the
  same rules as before.
- [ ] Nodes: the disk bars still fill in, and hiding then showing the Usage
  column re-triggers them.

## Pod drawer

- [ ] Summary shows an age that advances once a second.
- [ ] Switch to Logs, YAML and Terminal and back: nothing resets, the terminal
  keeps its session and the YAML draft survives the round trip.
- [ ] Leave the drawer open on the Terminal tab for a minute: typing stays
  responsive.
- [ ] Open the LLM tab and run an analysis: the prompt preview, the streaming
  answer and Hide prompt behave as they did in 2.13.4, and the answer is not
  interrupted by anything repainting under it.
- [ ] Switch from the LLM tab to Summary and back while an analysis is running:
  the result still lands on the tab.

## Main process

- [ ] Browse many resources and namespaces on a large cluster, then check the
  main process memory: it settles rather than climbing with every resource
  opened.
- [ ] `/resource-cache/status` still reports the entries it should, and
  clearing the cache still empties it.
