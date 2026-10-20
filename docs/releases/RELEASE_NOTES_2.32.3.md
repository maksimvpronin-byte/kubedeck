# KubeDeck 2.32.3 release notes

A pod held back by its init containers now shows them, and the Logs tab reads
their logs.

## Init containers

A pod stuck on a crashing init container - a database migration that fails,
say - read in 2.32.2 as plain *Pending* with no restarts. Nothing in the app
named the init container, and the Logs tab asked for the pod's regular
container, which kubectl refuses while the pod initializes: the tab showed
*kubectl command failed*. Now:

- **Logs tab.** The container list includes the init containers, marked
  *(init)*, in the order they run. Until a container is picked, the tab opens
  on the init step the pod is stuck on - the first one that has not completed;
  native sidecars (`restartPolicy: Always`) are skipped - and moves on to the
  pod's container once it starts.
- **A failed logs request clears the tab.** Before, the text of the Describe
  tab stayed on screen and was counted as log lines.
- **The pod row.** The Containers column shows a cube for an init container
  while it runs or fails (`init <name>` on hover); a healthy pod's cell is
  unchanged. Init containers' restarts count in Restarts, and a failing init
  container leads the row's problem reason, before the regular containers'
  *PodInitializing*.
- **Summary tab.** Init containers are listed first among the containers, a
  completed one as *completed* in green.

The terminal still offers only the regular containers. Deployment logs are
unchanged.

## Verification

No route changes. Node-only ownership stays at Node 60 / Python 0.

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **340 tests**, 4 new
- `npm --workspace apps/desktop run test:gateway` - **239 tests**, 1 new
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.32.3`
- `/migration/status` remains `node-only`, Node 60 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.32.3.md](./REGRESSION_CHECKLIST_2.32.3.md).
