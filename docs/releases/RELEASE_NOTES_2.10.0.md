# KubeDeck 2.10.0 release notes

KubeDeck 2.10.0 makes the project legally usable, closes an SSH trust gap and
adds Linux as a supported platform. It is a minor release: a new platform, a new
user-facing decision during SSH connect and two new Gateway routes.

## Apache-2.0 license

- KubeDeck is now published under the Apache License, Version 2.0.
- `NOTICE` reserves the KubeDeck name, logo and application icons. Apache-2.0
  Section 6 grants no trademark rights, so forks and derivative works must be
  distributed under a different name.
- `docs/third-party-notices.md` lists every redistributed third-party component
  with its version and license, verified against the committed lockfile.
- All three `package.json` files declare `Apache-2.0`, and the release gate now
  fails if the license files, the declared license or the third-party list fall
  out of sync with the production dependencies.

## SSH host key verification

Before this release Node SSH connected without verifying host keys, which meant
a password or key passphrase could be offered to a substituted host.

- An unknown host now stops the connection and shows its address, key algorithm
  and SHA256 fingerprint. Nothing is authenticated until the user accepts.
  Verification runs inside the SSH key exchange, before user authentication.
- Accepting stores the fingerprint in `hostkeys.json` inside the application
  data directory. The file is written atomically with `0600` permissions.
- A host whose remembered key changed is refused outright. The confirmation
  dialog is not offered in that case; the remembered entry has to be removed
  explicitly in Settings first.
- The jump host is verified independently of the target host. Trusting one
  grants nothing to the other.
- Declining, closing the tab or leaving the prompt unanswered for two minutes
  ends the connection attempt.
- Settings gained a **Remembered SSH host keys** section listing host, port, key
  type, fingerprint and confirmation date, with per-entry removal.
- The audit log records `host-key-trusted` and `host-key-mismatch` with host,
  port, algorithm and fingerprint. A public key fingerprint is not a secret;
  passwords and passphrases are still never recorded.
- New Gateway routes: `GET /ssh/known-hosts` and `DELETE /ssh/known-hosts`.
  There is deliberately no route that adds a host key over HTTP.

## Linux x64 AppImage

- `npm run package:linux` produces `KubeDeck-2.10.0-x86_64.AppImage`.
- The builder runs the full source gate, rebuilds `node-pty` for Electron,
  packages the AppImage and validates the release payload the same way the
  Windows and macOS builders do.
- Application data lives in `~/.config/KubeDeck/`.
- The packaging `afterPack` hook is now restricted to macOS, where the unpacked
  `node-pty` helper actually needs a permission repair.
- The AppImage needs FUSE 2. Distributions that ship only FUSE 3 can install
  `libfuse2` or use `--appimage-extract`.

## Release contract

- Root, desktop, shared-types and lock metadata are synchronized to 2.10.0.
- English and Russian README files, Help runtime versioning, changelog,
  migration status, release notes and regression checks are synchronized.
- The Node-only ownership contract moves to **Node 54 / Python 0**.

## Known limitations

- The Linux AppImage, the Windows Portable build and the macOS artifacts are all
  unsigned. macOS is additionally not notarized.
- Linux arm64 and macOS Intel are still unsupported.
- The LLM API key is still stored as plain text in `config.json`. Encrypting it
  through Electron `safeStorage` is tracked separately and is not part of this
  release.

This release contains neither a Python runtime nor a bundled `kubectl`.
