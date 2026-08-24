# KubeDeck 2.20.9 release notes

A node's disk percentage stops being worked out twice. No route changes.
Node-only ownership stays at Node 58 / Python 0.

## What it was doing

The resource table shows how full a node's disk is using `diskUsagePercent`,
which the main process calculates while it reads the node's metrics. The
resource Summary showed the same bar - and calculated the number again, like
this:

```ts
usagePercent(row.diskUsage, row.diskObservedCapacity ?? row.diskAllocatable ?? row.diskCapacity)
```

Those are **display strings**. `row.diskAllocatable` is `"31.38 GiB"`, produced
in the main process by formatting a number for a person to read. The Summary
took that string apart again with a regex to get the number back:

```ts
/^(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB)$/
```

So a value went number → string → number, across the process boundary, to
compute an arithmetic result that already existed one field away.

## Why it mattered

Two things, one of which nearly happened.

The percentage was derived from a **rounded** value: `31.38 GiB` has lost
everything past two decimals, and the division used what was left.

And the format was load-bearing without saying so. While consolidating the
quantity formatters in 2.20.7 this very string was a candidate for a new unit
spelling - `31.38 GiB` becoming `31.4 GiB`, or gaining a thousands separator.
Any of those would have made the regex miss, and the Summary's disk bar would
have quietly lost its percentage. It was caught during that work and written
down; this is the fix.

## What it does now

```ts
percent={diskUsagePercent(row)}
```

It uses `row.diskUsagePercent` - the number the main process already worked out,
and the same one the table shows. The two views cannot disagree any more.

Only when the disk probe returned a usage without a capacity does it fall back
and divide, and then from `diskUsageRaw`, `diskObservedCapacityRaw` and
`diskAllocatableRaw` - raw numbers and a Kubernetes quantity, which is a defined
format, rather than from something KubeDeck printed for a human.

The regex over the display string is gone.

## What you should see

Nothing, on a node where the probe returned a capacity - which is the normal
case, and where the two calculations already agreed.

On a node where the probe returned usage but no capacity, the percentage is now
computed from the unrounded allocatable rather than from a two-decimal
rendering. Expect a percentage point of difference at most.

## Tests

Nine assertions covering it directly, which was not possible before: the
function lived inside the React tree and was only reachable through it. They
include the case that motivated the fix - a row carrying only the formatted
strings now yields no percentage at all, rather than a number parsed out of
KubeDeck's own output.
