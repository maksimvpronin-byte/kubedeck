# KubeDeck 2.31.0 release notes

Labels can now be changed on many nodes at once, from the Nodes table.

## Labels on the selected nodes

Select nodes in the Nodes table - by hand, or by filtering on a label first
and taking the whole page with the header checkbox - and a **Labels** button
appears beside Cordon, Uncordon and Drain.

- The dialog lists every label the selected nodes carry, how many of them
  carry it ("2 of 3") and with which values.
- For each label: **Keep** it, **Set** one value on every selected node, or
  **Remove** it.
- New labels are added below and go on every selected node. Keys and values
  are checked against the Kubernetes rules as they are typed.
- Before anything is sent the dialog shows what each node will get - added,
  changed from one value to another, removed - and the `kubectl label`
  command for each node.
- Apply changes each node separately and sends it only what it needs. A node
  that already matches is not touched. If some nodes fail, the error names
  them and the rest keep their change.
- Roles, topology and other labels under `kubernetes.io` or `k8s.io` sit in a
  folded group with a warning: the scheduler and network plugins read them.
- The labels kubelet sets from the machine itself - `kubernetes.io/hostname`,
  `os`, `arch` and `instance-type` - are not offered, and the backend refuses
  them too.
- Changing labels needs permission to patch nodes, the same as Cordon. Every
  change is recorded in Local activity.

## Verification

Node-only ownership stays at Node 59 / Python 0. No route was added: the
resource action route takes one more action, `label`.

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **334 tests**, up from 327: a node is sent only
  the changes it needs and a matching node none; keys and values follow the
  Kubernetes rules and kubelet's labels are refused; the dialog lists the
  selected nodes' labels with how many carry each and none of kubelet's; set,
  remove and add become one change list with its commands, and nothing is
  sent before Apply; an invalid key cannot be added and an invalid value
  cannot be applied; Escape and Cancel send nothing; the Labels button hands
  over the selected nodes
- `npm --workspace apps/desktop run test:gateway` - **230 tests**, up from
  229: a label request checks `auth can-i patch nodes` and runs
  `kubectl label nodes <node> … --overwrite`, records the change in the audit
  log, refuses a kubelet label before anything runs, and refuses keys and
  values that are not valid labels or could be read as flags
- The commands were checked with `--dry-run=server` against a k3s 1.35
  cluster, and the dialog in the running app against the same cluster
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.31.0`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.31.0.md](./REGRESSION_CHECKLIST_2.31.0.md).
