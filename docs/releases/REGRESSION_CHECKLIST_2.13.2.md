# KubeDeck 2.13.2 regression checklist

Automated gates below ran and passed during development. Three of the new tests
measure rather than match text: ANSI contrast against each theme's own terminal
background, and the YAML jump scrolling the container that actually scrolls.
Manual items stay open until someone runs them on a real cluster.

The 2.13.0 and 2.13.1 checklists still apply; nothing in them was superseded.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## Terminal colours

- [ ] Switch to the light theme, open a pod terminal and run `top`: the numbers
  in the summary block are readable.
- [ ] Run `ls --color=always` in a directory with directories, links and
  archives: every entry is readable, none of them washes out.
- [ ] Run `kubectl get pods -o wide` and anything that prints bold text: bold
  stays darker than normal text rather than lighter.
- [ ] Repeat on midnight and one other dark theme: nothing became too dark to
  read there.
- [ ] Open a node SSH session on the light theme and confirm the same.

## Problems panel at narrow widths

- [ ] Open Problems with a resource drawer open on a wide screen: resource paths
  in the priority cards wrap as words, never per character.
- [ ] Narrow the panel further until the buttons move under the text: they do
  so before the text becomes unreadable.
- [ ] Widen back to two cards per row and confirm the summary row above reflows
  without overflowing.

## Find in YAML

- [ ] Open a long manifest, search for something near the bottom and press
  Enter: the view scrolls to it and the match is selected.
- [ ] Press the up and down arrows repeatedly: each press moves the view, and
  the counter and the visible match stay in step.
- [ ] Collapse a section, then search for text inside it: the section expands
  and the view lands on the match.
- [ ] Search for something on the first and last lines: both end up visible.
- [ ] Type in the search box after jumping: the caret stays in the search box.

## LLM

- [ ] Run an analysis on a pod: it still answers in Russian with the
  request/limit section intact.
