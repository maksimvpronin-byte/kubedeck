# KubeDeck 2.20.5 release notes

Internal cleanup. No behaviour change, no route changes. Node-only ownership
stays at Node 58 / Python 0.

## What moved

`PodDrawer.tsx` was 551 lines with 17 `useState` and no local helpers at all.
It is 390 now, with 11:

```
211  components/PodDrawerTabBody.tsx  the tab === … chain and the CRD notices
 39  hooks/usePodDrawerLlm.ts         the seven pieces of LLM analysis state
```

Seven of those seventeen states were the LLM tab's - `llmLoading`, `llmError`,
`llmAnswer`, `llmModel`, `llmElapsedMs`, `llmContextChars`, `llmTruncated` -
plus their reset, which lived inside the drawer's general per-object reset
effect. They are one hook now, and the reset lives where the state does: an
analysis belongs to the object it was run against, so moving the drawer to
another object clears it.

`PodDrawerTabBody` joins the four pieces that were already extracted in 2.10.2
and later - `usePodDrawerLogs`, `usePodDrawerYamlActions`,
`usePodDrawerResourceLifecycle`, `PodDrawerChrome`, `PodDrawerModals`.

## The forty-props problem

Lifting the tab chain out naively would have needed about fifty props: it reads
nearly everything the drawer gets from its four hooks. Instead the component
takes those bundles whole - `lifecycle`, `logs`, `yamlActions`, `llm` - typed
as `ReturnType<typeof usePodDrawerX>`. The hooks already define cohesive
groups, so handing one over as a single value is more honest than restating
forty names. That is 25 props instead of ~50, and no new types.

A side effect: the drawer no longer destructures `logs` at all (21 names) or
half of `lifecycle`. Those values are read where they are used.

The tab body landed in the drawer's own chunk, not the main bundle: `PodDrawer`
88.21 → 89.27 kB, `index` unchanged at 335.33 kB.

## Where it stopped

The plan said `PodDrawer.tsx` ≤ 320 lines. It is **390**, and the remaining 70
are not another chain to lift out: they are modal state (7 of the 11 `useState`),
the action handlers - `runAction`, `startPortForward`, `copyText`,
`openTerminal`, `requestClose`, `discardYamlAndClose` - and the header with its
six modals. That is the drawer itself. Splitting further would mean a component
per modal, which does not pay for itself.

## Two more grep contracts

`<ErrorPanel error={error}` and `<ResourceSummary … serviceEndpoints=
{serviceEndpoints}` were being asserted against `PodDrawer.tsx`; both moved to
`PodDrawerTabBody.tsx` and both were repointed. After the six in 2.20.4 this is
no longer news, but it is worth keeping count: eight source-text assertions have
now needed an edit purely because code moved. That is the running cost 2.20.3
put a number on.
