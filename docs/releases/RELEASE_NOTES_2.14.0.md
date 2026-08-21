# KubeDeck 2.14.0 release notes

KubeDeck 2.14.0 is a performance release. Nothing changes about what the
application does; several things it did constantly, and needlessly, it no
longer does. The one behavioural change is in how watch events are turned into
list reloads, and it fixes a table that could stop updating altogether.

No route changes. Node-only ownership stays at Node 58 / Python 0.

## Watch events no longer either storm or starve the resource table

A watch event scheduled a silent list reload 350ms later, and every further
event reset that timer. Two clusters broke on the two ends of that rule.

A cluster emitting an event more often than every 350ms - a busy namespace, or
any cluster with the events resource open - reset the timer forever, so the
reload **never ran**. The polling fallback could not step in either: it is
disabled while the watch reports healthy, and a socket delivering events is
healthy by definition. The table simply stopped updating, with no sign that
anything was wrong. Measured against the old rule, an event every 100ms over
eight seconds produced zero refreshes.

A cluster emitting an event every 400ms cleared the timer every time, so it got
a full `kubectl get <resource> -A -o json` at nearly event rate - twenty-five of
them over ten seconds in the same measurement.

Events are now coalesced with a floor and a ceiling as well as the settle time:

- the settle time is unchanged at 350ms, so a quiet cluster reloads exactly as
  before;
- two reloads never run closer together than one second, however fast events
  arrive;
- the table is never left unrefreshed for longer than three seconds, however
  long events keep arriving.

The same two measurements now produce two refreshes and nine, instead of zero
and twenty-five. The coalescer is a pure factory with injected timers, and a
test drives it through both cases.

## The resource table stopped repainting itself once a second

The age column needs a clock. It was read at the table level, so every tick
re-rendered every row of every column - on a default page that is two hundred
rows against nine columns, including the CPU, memory and disk usage bars, once
a second, forever, whether or not anything had changed.

The clock now lives in the age cell. One timer is shared by every reader, and
each cell compares the rendered text rather than the time, so a pod that has
been up for twelve days renders `12d`, React sees no change and skips it
entirely. Only ages younger than a day repaint at all, and they repaint one
text node instead of a row.

The pod drawer had the same problem in a smaller shape: its clock ran on every
tab, though only Summary shows an age, so the terminal and the YAML editor were
re-rendered once a second for nothing. It now ticks on Summary alone.

## Sorting a large table was an order of magnitude slower than it needed to be

Rows were compared with `localeCompare(value, undefined, { numeric, sensitivity })`,
which rebuilds the collator behind every single comparison. The comparison runs
on every list refresh and on every keystroke in the filter box.

A cached `Intl.Collator` produces the identical ordering. Measured over five
thousand rows:

```text
localeCompare(options): 217.2 ms per sort
cached Intl.Collator  :  11.2 ms per sort
```

## Memoisation that was being defeated

Two values were rebuilt on every render of the application shell and handed to
the table as fresh identities, which re-ran its filter and sort for nothing: the
column list for CRD and fallback tabs, built inline, and the `?? []` fallback
for a resource that has no rows yet. Both are stable now.

## The resource snapshot cache no longer holds expired snapshots for the session

Expired entries were only dropped when something read or listed the cache. The
resource tables deliberately read live rather than cached, so on that path
nothing ever read it - and a full array of normalised rows was retained for
every resource and namespace ever opened, until the cluster was disconnected.
Writing an entry now sweeps the expired ones. Expired already counted as
absent, so nothing observable changes.
