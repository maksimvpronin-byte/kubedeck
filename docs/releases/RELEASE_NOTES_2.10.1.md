# KubeDeck 2.10.1 release notes

KubeDeck 2.10.1 closes the last plaintext-secret gap left open in 2.10.0: the
LLM API key. It is a patch release — no new platform, no protocol change
outside the existing `PUT /settings` and `POST /llm/test` routes.

## Encrypted LLM API key storage

Before this release the LLM API key was stored as a plaintext string in
`config.json`, with no file-permission hardening, and was echoed back to the
renderer on every `GET /config` and `PUT /settings` response.

- The key is now encrypted at rest via Electron `safeStorage` in
  `<appDataRoot>/secrets/llm-api-key.bin`. The `secrets/` directory is created
  with `0700` and the file with `0600` permissions on POSIX.
- `config.json` no longer carries the key value at all — only
  `llm.apiKeyConfigured: boolean`, indicating whether one is saved.
- The decrypted value exists only in the main process's memory for the
  duration of an outbound LLM request and is never logged or written to disk.
- `PUT /settings` and `POST /llm/test` take a dedicated `apiKeyUpdate`
  (`keep` / `replace` / `clear`) instead of embedding the key in the settings
  object. This preserves the existing "test an unsaved key before saving it"
  flow in Settings without ever persisting the candidate value.
- A one-shot migration runs on first launch after upgrade: any existing
  plaintext key is found across `config.json`, `config.backup.json`,
  `config.broken.json` and leftover temp files, moved into encrypted storage,
  and stripped from every file it was found in.
- If encrypted storage isn't available on the host (notably headless Linux
  without a keyring service such as `gnome-keyring` or `kwallet`), the
  migration leaves the existing plaintext key in place but tightens its file
  permissions to `0600`, and saving a new key is rejected with
  `SECRET_STORAGE_UNAVAILABLE`. `GET /llm/status` now exposes
  `secretStorageAvailable` so Settings can show this state to the user.
- `config.json` and `config.backup.json` are now written with `0600`
  permissions on every save, independent of the LLM key.

## Known limitations

- On hosts without a working OS keyring, the LLM API key cannot be encrypted;
  KubeDeck falls back to permission-only protection and surfaces this in the
  UI rather than silently storing the key insecurely.
- The Linux AppImage, Windows Portable build and macOS artifacts remain
  unsigned, and macOS is not notarized.

## Release contract

This release contains no route or contract-count change: `PUT /settings` and
`POST /llm/test` gain an expanded request/response shape on existing routes,
not new endpoints. The Node-only ownership contract stays at Node 54 / Python 0.
