# KubeDeck 2.20.7 regression checklist

Nine formatters became one shared module, the PTY size limits became one
declaration, and the SSH payload checks moved out of the session class.

Unlike the six patches before it, this one **does change what is on screen** -
in small ways, in a lot of places. The list under "Every changed reading" is the
whole of it; anything not on that list should look exactly as it did in 2.20.6.

Earlier 2.13.x through 2.20.6 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (**114 tests**)
- [x] `npm --workspace apps/desktop run test:gateway` (**153 tests**)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**
- [x] `dist/shared/formatQuantity.js` is emitted, and the renderer bundle
  contains the same module

## Every changed reading

- [ ] **LLM analysis** on a pod with a memory request: the prompt preview reads
  `70 MiB`, not `70Mi`.
- [ ] A pod with a limit of exactly one core: the prompt reads `1 core`, not
  `1 cores`.
- [ ] **Overview → capacity, CPU**: a sub-core total reads `250m`, not
  `250 mCPU`. A large cluster still groups thousands, e.g. `1 024 cores`.
- [ ] **Overview → capacity, memory**: above 1024 GiB it now reads in TiB.
- [ ] **Secret tab**: a 1 KiB value reads `1 KiB`, not `1.0 KiB`.
- [ ] **Nodes table, Disk and RAM usage bars**: a KiB-scale reading now carries
  two decimals; a TiB-scale disk reads in TiB rather than four-digit GiB.
- [ ] Anywhere a value is exactly one core, it reads `1 core`.

## Every reading that must NOT have changed

These were left alone deliberately, and a change here is a regression.

- [ ] **Pods table, Usage column**: the reading and the limit beside it are both
  in Kubernetes notation - `403840Ki used · 512Mi limit`, `1500m`, a bare `2`
  for two cores. If a limit reads `1.5 cores` next to a `403840Ki` reading, that
  is the bug this checklist is looking for.
- [ ] **Nodes table, capacity columns**: `8.00 GiB` and `31.38 GiB` with the
  decimal points under each other - two decimals always, never `8 GiB`.
- [ ] **Resource Summary quota rows**: unchanged.
- [ ] **Usage history chart**: legend and axis unchanged.

## Terminals and SSH

The PTY size limits are now declared once, and Node SSH adopted the pod
terminal's numbers.

- [ ] Open a **Node SSH** session: it fills the panel and the shell agrees about
  its size (run `stty size`, or `clear` and check nothing wraps oddly).
- [ ] Drag the terminal panel **very short**: the session still works. It used
  to stop shrinking at 8 rows and now goes to 5.
- [ ] Drag it tall and back; resize the window; the shell keeps up.
- [ ] Same three checks for a **Pod Terminal** - its numbers did not change, so
  this is the control.
- [ ] Connect over SSH with a **password**, with a **private key**, with the
  **agent**, and through a **jump host**.
- [ ] The command preview in the drawer shows the right `ssh` line, quotes a key
  path containing a space, and **never shows the password**.
- [ ] A host key prompt on first connect, and rejecting it closes the session.
- [ ] Bad input is refused with a message, not a hung socket: an empty host, a
  host with a space in it, a port of 70000, an empty user, `privateKey` with no
  path, `password` with no password.

## Nothing else moved

- [ ] Resource tables, drawer, Overview, Problems, Global Search, Settings.
- [ ] Port forwards start, open and stop.
- [ ] Switch themes and languages.
- [ ] Help and About report **2.20.7**.
