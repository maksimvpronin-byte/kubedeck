# KubeDeck 2.32.5 release notes

A build-tooling release. The app is the same as 2.32.4. The build no longer
carries a 7-Zip binary that a dependency scan flagged and nothing ran.

## 7zip-bin is gone

A Grype scan of `package-lock.json` reported 20 7-Zip CVEs (13 high, 6 medium,
1 low). All 20 are against the `7za.exe` 21.07 inside `7zip-bin` 5.2.0. That
is the last release of the package, published in 2022, so no update fixes them.

Nothing ran that binary. electron-builder 26 gets its own 7za from the
`7zip@1.0.0` toolset of electron-builder-binaries: it downloads it, checks it
against a pinned checksum, and on Windows it is 7-Zip 24.09. It can also take
one from `ELECTRON_BUILDER_7ZIP_PATH`. `7zip-bin` was a direct
devDependency, at the root and in `apps/desktop`, left over from 1.0.3, when
electron-builder still read `node_modules/7zip-bin`.

- `7zip-bin` is removed from both `package.json` files and from the lock.
- `scripts/repair-7zip-bin.ps1` is removed, along with the call to it in the
  Windows portable build.
- `build-macos.sh` no longer looks for a 7za or links one in.
- `p7zip` is no longer in the macOS build requirements.

The binary was never part of an installed app, because it came with a
development dependency.

## Verification

No route changes. Node-only ownership stays at Node 60 / Python 0.

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **340 tests**
- `npm --workspace apps/desktop run test:gateway` - **245 tests**
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.32.5`
- `npm audit` - 0 vulnerabilities
- `npm --workspace apps/desktop run dist:win` builds the installer and the
  portable build without `7zip-bin` installed
- `/migration/status` remains `node-only`, Node 60 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.32.5.md](./REGRESSION_CHECKLIST_2.32.5.md).
