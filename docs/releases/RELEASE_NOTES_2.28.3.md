# KubeDeck 2.28.3 release notes

A large cluster opens in a fraction of the time, coloured logs read as colours,
a Service can be port-forwarded from where you look for it, and the cluster name
stays in sight.

## A large cluster shows its rows in well under a second

Opening a cluster with ~1700 pods left the Pods table blank for 3-4 seconds.
Almost none of that was drawing the table: it was kubectl.

- Built-in lists - pods, deployments, services and the rest of the tree - are
  read straight from the API server. `kubectl get pods -A -o json` spent over a
  second re-encoding every object; the same list now takes about a tenth of
  that, on every open and on every refresh a change in the cluster triggers.
  Custom resources are listed as before.
- Opening a cluster asks one question instead of three in a row before the
  first list starts, and the list of resource types arrives alongside instead
  of in front of it.
- A slow metrics-server no longer holds the table back. Rows appear at once;
  CPU and memory fill in from what KubeDeck already recorded, within a couple
  of seconds on a cluster opened a moment ago.
- Measured on 1700 pods with 60 ms to the API server: from 2.2-2.6 s to the
  first rows down to about 0.6 s. Clusters that sign in through a plugin
  (EKS, GKE, OIDC) save one more sign-in per step removed.

## Less background work

- Namespaces are refreshed once a minute, not at every table refresh, and not
  again right after opening a cluster.
- While the window is minimised, the namespace list, Overview, Problems and
  the table's fallback refresh stop asking the cluster, and pick up again when
  it comes back.

## Log colours are colours

Programs that colour their output - loggers, test runners, anything that thinks
it has a terminal - write escape sequences into the log. The Logs tab printed
them: a box for the escape character and `[32m` after it.

- The colours are shown now, in the same palette as the pod terminal, following
  the theme. Bold, italic, underline, 256 colours and true colour are read too.
- A colour carries to the next line until it is reset, so a stack trace printed
  in red stays red to its last frame.
- Search and the filter read the text on screen: a word split by a colour
  change is found as one match.
- Copy and the "Current view" download take the text without the escapes. The
  full download is the log exactly as the cluster sends it.

## Port forwarding a Service

A Service could already be port-forwarded, from an unlabelled icon in the
drawer header that looked like the Related tab's. It was not found.

- "How to reach it" on a Service's summary has a port-forward button for each
  of its TCP ports. The window opens on that port.
- The window offers a Service only its own ports. It used to offer targetPorts
  and nodePorts too, which `kubectl port-forward svc/...` refuses.
- An ExternalName Service, or one with UDP ports only, has nothing to forward
  to and no longer offers it.
- Port forwarding has its own icon, two opposite arrows, in the header and on
  these buttons.

## The cluster name stays at the top

The cluster's name and menu above the resource tree scrolled away with it. They
stay at the top of the sidebar now while the tree scrolls under them.

## Verification

Node-only ownership stays at Node 59 / Python 0, and no route changed.

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **320 tests**, up from 307: escapes in a log render
  as coloured spans and never as text, search and the filter match the visible
  text across colour changes, a colour carries to the next line, copy strips
  the escapes; a Service's TCP ports each open the port-forward window on that
  port, the window offers only the Service's own ports, an ExternalName or
  UDP-only Service offers no port forward; opening a cluster asks discovery
  alongside the open and makes the cluster active before it answers, a late or
  failed discovery neither blocks nor removes it; namespaces are not asked
  again after an open, at most once a minute, and not while the window is
  hidden
- `npm --workspace apps/desktop run test:gateway` - **191 tests**, up from 187:
  opening a cluster is a single `get namespaces`; built-in lists are read from
  their API path with the item kind filled from the list, custom resources and
  a path the server does not serve go through `kubectl get`; a pod list
  answers without waiting for a slow `kubectl top`, with the recorded usage
- Raw and `-o json` reads of 1700 generated pods normalize to identical rows
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.28.3`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.28.3.md](./REGRESSION_CHECKLIST_2.28.3.md).
