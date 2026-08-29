# KubeDeck 2.23.3 release notes

Two things the reader could see, and the gap that let one of them ship. Node-only
ownership stays at Node 59 / Python 0, and no route changed.

## What this fixes

**The command palette separates its subtitles with a dot again.** Since 2.20 the
middle dot in every palette subtitle has been `Р’В·` - "CRD Р’В· apps", "Pods Р’В·
kube-system", and the same on every global search result and its matched fields.
When the palette was extracted from `App.tsx` in 589ba88 the character (C2 B7)
was read as CP1251 on the way out and again on the way back; each pass turned one
character into two more.

Nothing could have caught it. The file is valid UTF-8 either way, the strings
type-check either way, and no test read a subtitle. It was visible only to a
person opening the palette, and it stayed that way for three releases.

**A log search jump moves across the pane as well as down it.** Log lines are not
wrapped, so the column an occurrence sits in is as much a part of where it is as
the row. Stepping between matches only ever moved rows, so a match a thousand
pixels past the right edge stayed off screen and the pane looked like the jump
had done nothing at all.

## What this adds

The guard for the first fix is deliberately not about that file. A contract test
walks the whole of `apps/desktop/src` for the sequences UTF-8 punctuation turns
into when it is read as CP1251 or Latin-1. None of them is text anyone would
type, and the tree is clean of them, which is what makes their absence something
a test can hold. Checked by reintroducing the mojibake: the test failed and named
the file.

A second test walks one ClusterIP Service from the normalizer to the addresses it
becomes - through `serviceSummary`, through the JSON round trip the resource list
route performs, and into `serviceAddresses` and the port-forward command. The two
halves were previously tested apart against hand-written expectations, with the
field name `servicePortItems` between them that neither test owned. Renaming it on
one side would have left both suites green and the drawer showing a bare host and
"the Service declares no ports" - the same shape of gap that let the palette ship
broken. Checked by renaming it in the normalizer alone: the six older tests stayed
green and only the new one failed.

## Tooling

`npm run format:check` failed on configuration rather than on any file. Biome
walked into `.claude/worktrees`, found a checkout of this project carrying its own
`biome.json`, and refused to run at all on the nested root config. `files.includes`
did not help, because the nested config is found before includes are applied.
`.claude` is now excluded outright, so the gate passes whether or not a worktree
happens to exist.

## Files

| File | |
|---|---|
| `apps/desktop/src/renderer/hooks/useCommandPaletteItems.ts` | the four repaired separators |
| `apps/desktop/src/renderer/utils/revealMatch.ts` | the per-axis scroll, new |
| `apps/desktop/src/renderer/components/LogsTab.tsx` | uses it for both axes |
| `apps/desktop/tests/renderer-controllers.contract.test.cjs` | the codepage guard |
| `apps/desktop/tests/yaml-editor.contract.test.cjs` | the reveal contract |
| `apps/desktop/tests/resource-detail.contract.test.cjs` | the Service walk |
| `biome.json` | `.claude` excluded |

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **145 tests**, up from 142
- `npm --workspace apps/desktop run test:gateway` - **170 tests**, unchanged
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- Both new guards checked by reintroducing the defect they cover
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.23.3.md](./REGRESSION_CHECKLIST_2.23.3.md).
