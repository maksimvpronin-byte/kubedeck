# KubeDeck 2.28.3 release notes

Three fixes: coloured logs read as colours, a Service can be port-forwarded from
where you look for it, and the cluster name stays in sight.

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
- `npm run test:renderer` - **316 tests**, up from 307: escapes in a log render
  as coloured spans and never as text, search and the filter match the visible
  text across colour changes, a colour carries to the next line, copy strips
  the escapes; a Service's TCP ports each open the port-forward window on that
  port, the window offers only the Service's own ports, an ExternalName or
  UDP-only Service offers no port forward
- `npm --workspace apps/desktop run test:gateway` - **187 tests**, unchanged
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.28.3`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.28.3.md](./REGRESSION_CHECKLIST_2.28.3.md).
