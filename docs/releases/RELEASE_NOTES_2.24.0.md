# KubeDeck 2.24.0 release notes

A release you can be handed, instead of one you have to come and fetch.
Node-only ownership stays at Node 59 / Python 0, and no route changed.

## There had never been a release

The last tag in this repository is `v2.0.0-beta.1`. Every build since was
carried off the machine that made it, and the application had no way at all to
learn that a newer version existed.

A `v*` tag now runs `.github/workflows/release.yml`:

- **`guard`** checks the release contract and that the tag agrees with the
  version. Plain Node, no `npm ci`, about thirty seconds - half an hour of
  packaging should not be spent discovering that a tag and a version disagree.
- **`build`** packages the three platforms with the same `package:mac`,
  `package:win` and `package:linux` scripts a build by hand uses, so CI and a
  desk cannot drift apart. Each runs the full source gate, the release
  contract, its own `node-pty` rebuild and the payload check.
- **`release`** assembles one draft from what the three produced, with the
  notes taken from this file rather than generated.

**electron-builder is never allowed to upload for itself.** It looks a release
up by tag; a draft has no published tag, so the lookup answers 404 for a release
that plainly exists, and every publish that asks is told there is none and
creates a draft of its own. Every packaging script therefore passes
`--publish never`, and `verify:release` checks that it still does.

A run that is not a tag skips the publishing job and leaves the packages on the
run, which is what makes **Run workflow** a way to test a build.

## About knows when it is out of date

`electron-updater`, and a card in About. Nothing is downloaded until it is asked
for: a release is a couple of hundred megabytes, and taking that unasked is rude
on a tethered connection and pure waste on a build that cannot install it.

Two builds are told what exists and no more, because neither can replace itself:

| build | why | what it gets |
|---|---|---|
| Windows portable | unpacks itself into a temporary directory; there is no installation to replace | the release page |
| macOS without a Developer ID | Squirrel will not replace a bundle whose signature it cannot match | the release page |
| Windows installer, Linux AppImage | replaceable in place | download and restart |

The second row is **asked of `codesign` at runtime** rather than assumed, so the
answer corrects itself the day a certificate is configured instead of staying
wrong until somebody remembers the line. Windows gains an NSIS installer beside
the portable executable, named without spaces - the name is also a URL, and
GitHub turns spaces in an uploaded file name into dots, which is a 404 the
updater reports to nobody.

## Three things that had never worked

All three were found by running the packaging on a machine that had never built
KubeDeck before, which until now had never happened.

- **An unsigned macOS build does not start.** An arm64 executable without a
  signature is refused by the kernel, and macOS calls the download damaged
  rather than unverified. It never bit while the DMG was carried by hand from
  the machine that built it; it bites the moment it is downloaded. The
  `afterPack` hook now signs ad-hoc when there is nothing better, and skips
  itself when there is.
- **The Linux package had never been built.** electron-builder names the Linux
  executable after the npm package rather than after `productName`, and this one
  is scoped: `@kubedeck/desktop` becomes `@kubedeckdesktop`, which it then
  refuses as a file name. The AppImage the README described was a description of
  an intention.
- **The Windows builder failed on a diagnostic.** Under
  `$ErrorActionPreference = "Stop"`, a native command whose stderr is redirected
  turns that stderr into a terminating error whatever its exit code.
  `node -e "require('rolldown')" 2>$null` asks whether rolldown loads; rolldown
  is an ES module, so Node writes an ExperimentalWarning while answering yes,
  and the answer killed the build.

A fourth was found the same way: the new signing test compared against a literal
POSIX path while the hook builds one with `path.join`, so it passed on macOS and
failed on Windows by one backslash.

## What the contract now checks

`npm run verify:release` gained: the tag against the version (`--tag`), the
`publish` block without which electron-builder writes no update metadata at all,
`--publish never` in every packaging script, no whitespace in any artifact name,
and `latest*.yml` in the payload. `Verify` runs on every branch rather than only
on `main`.

## What this release does not prove

- **The update path itself.** A first release can only show that the metadata is
  there and that it names files which exist. Whether an update actually applies
  is answered by the release after this one.
- **The installer and the AppImage have not been launched by a human.** They
  build, they contain what they should, and nobody has double-clicked them.

## Verification

- `npm run lint`, `npm run lint:css` (ratchet at 0), `npm run format:check`
- `npm run test:renderer`, `npm --workspace apps/desktop run test:gateway` -
  **173 tests**, up from 170
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- All three platforms packaged on GitHub runners, payload check green on each
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.24.0.md](./REGRESSION_CHECKLIST_2.24.0.md).
