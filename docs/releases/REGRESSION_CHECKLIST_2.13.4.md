# KubeDeck 2.13.4 regression checklist

Automated gates below ran and passed during development, including a test that
checks Help and About against the behaviour they describe rather than only
against themselves.

Earlier 2.13.x checklists still apply; nothing in them was superseded.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## Help

- [ ] Open Help in both languages: every card renders and no entry shows a raw
  translation key.
- [ ] Follow the quick start on a fresh profile: each step matches what the
  interface actually offers, starting with the cluster rail.
- [ ] Read the connection card against the rail: the badge colours it describes
  are the colours you see.

## About

- [ ] Open About: the licensing card shows Apache License 2.0, the copyright
  line and the third-party pointer.
- [ ] Compare the copyright line with `NOTICE` in the repository: they match
  word for word.
- [ ] With no LLM configured, the cluster card shows the "not configured" text;
  configure one and it shows model and base URL.

## Cluster and LLM in the diagnostics

- [ ] Connect one cluster, leave another disconnected, press Copy diagnostics
  and paste: `connected` is true for exactly the connected one.
- [ ] Configure an LLM, copy diagnostics again and search the text for the API
  key: it is not there.
- [ ] Open the paths from About: each button opens the folder it names.
