# KubeDeck 2.20.11 release notes

Test-suite and documentation only. Not a line of `apps/desktop/src` changed. No
route changes. Node-only ownership stays at Node 58 / Python 0.

## Closing out the refactor plan against itself

`docs/file-structure-refactor-plan.md` ran for eight sections and eleven
releases. Reading it back against the tree afterwards, four things it claimed
were not true. Three were documentation. One was real, and it was self-inflicted.

## The real one

Section C (2.20.3) split the renderer test junk drawer and set a criterion: no
test file over 700 lines. Four releases later `node-ssh.contract.test.cjs` was
**849 lines** - because section G and 2.20.10 appended tests to it. It had been
674 when section C measured it, comfortably under, so nobody looked again.

A criterion that lives in a plan rather than in a gate breaks quietly. This one
did.

It is now four files:

```
307  tests/helpers/ssh.cjs                    the fake ssh2 client and channel,
                                              the gateway wired to them, the
                                              websocket helpers
241  node-ssh-host-keys.contract.test.cjs     the prompt, the decisions, a
                                              changed key, the jump host checked
                                              separately, the known-hosts store
206  ssh-payload.contract.test.cjs            the connect message, every field
                                              limit, the command preview - all
                                              pure, no gateway, no fakes
142  node-ssh.contract.test.cjs               the session itself: output, input,
                                              resize, audit redaction, shutdown
```

Same 154 gateway tests, none rewritten.

## The three documentation ones

- `ssh/nodeSshWebSocket.ts` is 704 lines. Section G explained why the remainder
  is one coherent machine and should not be cut further, but the programme
  criterion said "over 700 needs a justification **in the exceptions section**",
  and it was not listed there. It is now.
- `resource-lists.contract.test.cjs` (798) and `llm.contract.test.cjs` (794) had
  the same problem: scoped out in section C, missing from the programme-level
  list.
- The "Автоматический gate" block was seven unticked checkboxes - a template
  that read like seven undone tasks. It is a list now, and it names
  `npm run lint:css`, which section H added.

The programme criterion is also rewritten to say plainly what was achieved and
what was not, instead of stating targets that two sections had already recorded
as unreachable.

## What is left open, deliberately

Three items, all marked as such in the plan:

- The manual regression passes for sections B and H - the drawer, Related and
  Summary on eight themes, and every button on eight themes. Those are the
  owner's to run.
- Expressing precedence by specificity instead of `!important` in
  `drawer-controls.css` and `related-panel.css`. Not doable by analysis; needs
  the running application.
