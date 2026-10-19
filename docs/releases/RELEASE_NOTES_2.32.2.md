# KubeDeck 2.32.2 release notes

A saved resource tab whose object cannot be shown now says why, in the
interface language and in the app's own style.

## When a resource tab's object is gone

A saved resource tab can lose its object: a Deployment replaces its pods under
new names, an object is deleted, or the cluster does not answer. In 2.32.1 the
drawer's place then showed the raw status ("Not-Found"), a plain grey browser
button and a Retry that was never translated. Now:

- A card in the drawer's place names the object and says what happened: *No
  longer in the cluster* or *Could not open*, with a line on why - a
  Deployment's pods come back under new names, open the new one from the list.
- **Retry** looks again; **Close tab** closes the tab. Both use the app's
  buttons and follow the theme, light or dark.
- While the tab opens, the card says *Opening...* and offers no buttons.
- The tab label shows the status in the interface language too: *gone*,
  *opening*, *unavailable* (*нет в кластере*, *открытие*, *недоступно*).

## Verification

No route changes. Node-only ownership stays at Node 60 / Python 0.

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **336 tests**, unchanged
- `npm --workspace apps/desktop run test:gateway` - **238 tests**, unchanged
- The card checked with the built stylesheet in the dark and light themes
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.32.2`
- `/migration/status` remains `node-only`, Node 60 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.32.2.md](./REGRESSION_CHECKLIST_2.32.2.md).
