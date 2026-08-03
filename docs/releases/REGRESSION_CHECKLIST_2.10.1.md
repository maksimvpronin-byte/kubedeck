# KubeDeck 2.10.1 regression checklist

Automated gates below ran and passed during development. The manual
"LLM API key encryption" and "Product regression" sections were not
performed — decided to skip rather than leave silently unchecked.

## Automated gates

- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm --workspace apps/desktop run test:gateway`
- [ ] `npm run verify:release`
- [ ] `/migration/status` remains `node-only`, **Node 54 / Python 0**

## LLM API key encryption

- [ ] Setting a new API key in Settings and saving creates
  `<appDataRoot>/secrets/llm-api-key.bin` with `0600` permissions (`0700` on
  the `secrets/` directory) on macOS and Linux.
- [ ] `config.json` after saving contains `llm.apiKeyConfigured: true` and no
  `apiKey` field anywhere (including `config.backup.json`).
- [ ] Restarting the app without re-entering the key still allows "Test
  connection" to succeed — the encrypted key is read back correctly.
- [ ] "Test connection" with a freshly typed, unsaved key succeeds without the
  key ever appearing in `config.json`.
- [ ] Clearing the key (checkbox + save) flips `apiKeyConfigured` to `false`
  and removes `secrets/llm-api-key.bin`.
- [ ] Upgrading from a 2.10.0 install with a plaintext key already saved
  migrates it automatically on first launch: `config.json` no longer contains
  `apiKey`, `secrets/llm-api-key.bin` exists, and the previously configured key
  still works without re-entry.
- [ ] The API key value never appears in `desktop.log` or the audit log during
  any of the above.
- [ ] `GET /llm/status` returns `secretStorageAvailable: true` on a normal
  desktop session.
- [ ] Settings UI shows the "encrypted storage unavailable" warning when
  `secretStorageAvailable` is `false` (can be forced by disabling the OS
  keyring on Linux), and saving a new key in that state fails with a clear
  error instead of silently succeeding.

## Product regression

- [ ] Cluster import, switching, removal, namespace selection and refresh work.
- [ ] SSH host key confirmation flow from 2.10.0 is unaffected.
- [ ] LLM status, preview and analysis work without receiving Kubernetes logs.
- [ ] Settings save/load round-trips for non-LLM fields (SSH defaults, theme,
  language) are unaffected by the `apiKeyUpdate` change.
