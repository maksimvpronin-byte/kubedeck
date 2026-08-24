# KubeDeck 2.20.7 release notes

Internal cleanup with a handful of small display changes, listed below. No route
changes. Node-only ownership stays at Node 58 / Python 0.

## What moved

```
79  shared/formatQuantity.ts         both quantity formats, once
15  backend/terminal/ptyGeometry.ts  the PTY size limits, once
160 backend/ssh/sshPayload.ts        the pure checks on an SSH connect message
```

The audit that opened this work found seven places formatting a CPU or memory
value. There were **nine** - `resources/metrics.ts` held two, one of which the
first sweep missed entirely - with four different rounding rules and two
spellings of the same unit.

`src/shared/` is a new directory, a third one beside `main`, `preload` and
`renderer`. It works for both processes: `tsc` emits it to `dist/shared`, vite
bundles it. Without it this would have been two copies either side of the
process boundary, which is the thing the section exists to remove.

`nodeSshWebSocket.ts` goes from 849 lines to 704; the session class is untouched.

## There are two formats, not one

Collapsing everything into one shape would have been a mistake, and it nearly
happened. The first pass brought the table's limit label into the common
format - `1500m` became `1.5 cores`. But the table prints that limit **next to
the reading itself**, `row.cpuUsage`, which the backend writes in Kubernetes
notation. The bar would have read:

```
403840Ki used · 1.5 cores limit
```

One bar, two ways of writing a quantity. The old format in the table was not
an outlier; it matched its neighbour. So the shared module carries two formats,
and the difference now has a name:

- **Display** - `31.38 GiB`, `1.5 cores`, `250m`. What a person reads: labels,
  Overview tiles, the chart legend, the LLM prompt.
- **Kubernetes notation** - `403840Ki`, `1500m`, `2`. What `kubectl top` prints,
  what the sampler stores, and what the usage column shows.

Each call site says which it wants, and why, in a comment.

## What changed on screen

Not "one effect", as the plan assumed - a list:

- LLM prompt: `31.4Gi` → `31.4 GiB`, and `1 cores` → `1 core`.
- Overview CPU capacity: `250 mCPU` → `250m`. Thousands separators are kept -
  the shared formatter offers them, and this is the only caller that asks.
- Overview memory capacity: gains TiB above 1024 GiB.
- Secret size: `1.0 KiB` → `1 KiB`.
- Node disk and memory usage: KiB now carries two decimals instead of one, and
  TiB appears above 1024 GiB.
- Anywhere a value is exactly one core: `1 cores` → `1 core`.
- Node SSH: default 30 rows becomes 24, and the floor of 8 becomes 5, matching
  pod exec. Nothing explained the difference and nothing depended on it.

**Deliberately unchanged:** the table's usage column, for the reason above, and
the node capacity columns, where `8.00 GiB` sitting above `31.38 GiB` lines the
decimal points up - the shared formatter has a `fixed` option named for exactly
that.

## Two things found on the way, not fixed here

**SSH port 0 silently becomes 22.** `payload.port || 22` treats zero as unset.
Not a hole - 22 is the safe answer - but a user who typed 0 is not told it was
ignored. A test now records the behaviour as it is.

**The renderer parses back a string it asked the backend to format.**
`ResourceSummary` takes `row.diskAllocatable` - `"31.38 GiB"`, assembled in the
main process - and picks it apart with a regex to work out a percentage, while
`diskAllocatableRaw` sits in the same row with the number in it. That coupling
is why the two backend formatters could not be changed freely. Fixing it changes
a percentage calculation, so it belongs in its own patch.

## Tests

Twelve new behavioural tests: five on the shared formatter (both formats, the
fixed-unit option, and why grouping is off by default) and seven on
`sshPayload` - the connect message, every field limit, the jump host inheriting
the target's user, the size clamp, and the command preview never showing a
password.

The renderer suite is at 114 tests, the gateway suite at 153.
