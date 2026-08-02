# KubeDeck 2.10.0 regression checklist

## Automated gates

- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm --workspace apps/desktop run test:gateway`
- [ ] `npm run verify:release`
- [ ] `/migration/status` remains `node-only`, **Node 54 / Python 0**

## License

- [ ] `LICENSE` contains the unmodified Apache License 2.0 text.
- [ ] `NOTICE` names the copyright holder and reserves the KubeDeck name and
  icons.
- [ ] Root, desktop and shared-types `package.json` declare `Apache-2.0`.
- [ ] `docs/third-party-notices.md` matches the production dependencies in
  `package-lock.json`; no component is missing and no removed component remains.
- [ ] Both README files link to `LICENSE` and `NOTICE`.

## SSH host keys

- [ ] Connecting to a node for the first time shows the confirmation with host,
  port, key type and full SHA256 fingerprint.
- [ ] The fingerprint matches `ssh-keyscan -t <type> <host>` run from a trusted
  machine.
- [ ] Declining the prompt closes the session and reports a rejected host key.
- [ ] Leaving the prompt unanswered for two minutes ends the attempt.
- [ ] Accepting connects, and reconnecting to the same host does not prompt
  again.
- [ ] `hostkeys.json` appears in the application data directory with `0600`
  permissions on macOS and Linux.
- [ ] After the remote host key is regenerated, KubeDeck refuses to connect and
  does not offer to trust the new key.
- [ ] Removing the entry in Settings makes the next connection prompt again.
- [ ] With a jump host, both the jump host and the target host are confirmed
  separately.
- [ ] Password, passphrase and private key content appear in neither
  `desktop.log` nor the audit log for any of the cases above.
- [ ] Settings lists remembered host keys in English and Russian and removes a
  single entry without touching the others.
- [ ] Existing Pod Terminal sessions and the shared Terminal Workspace behave as
  before.

## Linux

- [ ] `npm run package:linux` completes on Ubuntu LTS x64 and produces
  `KubeDeck-2.10.0-x86_64.AppImage`.
- [ ] The AppImage starts by double click and from a terminal.
- [ ] The application window starts with the Chromium sandbox enabled; if it does
  not, the limitation is documented rather than worked around with
  `--no-sandbox`.
- [ ] Cluster import, resource lists, namespace selection and watch work.
- [ ] Pod Terminal works, confirming the Linux `node-pty` build.
- [ ] Node SSH works, including the new host key confirmation.
- [ ] Port Forward starts, opens and stops, and cleans up on exit.
- [ ] Application data is created under `~/.config/KubeDeck/`.
- [ ] Help reports version 2.10.0.
- [ ] Themes and both languages render correctly.

## Packaging

- [ ] Windows produces `KubeDeck-Portable-2.10.0-x64.exe`.
- [ ] macOS produces `KubeDeck-2.10.0-arm64.dmg` and `KubeDeck-2.10.0-arm64.zip`.
- [ ] The macOS `spawn-helper` remains executable; the `afterPack` change did not
  break it.
- [ ] All three release payloads contain neither a Python runtime nor a bundled
  `kubectl`.

## Product regression

- [ ] Cluster import, switching, removal, namespace selection and refresh work.
- [ ] Summary, YAML, Describe, Events, Related, Logs, Secrets and actions work.
- [ ] Pod Terminal, Node SSH, Port Forward and shutdown cleanup work.
- [ ] Keyboard navigation and focus-visible states remain usable.
- [ ] LLM status, preview and analysis work without receiving Kubernetes logs.
