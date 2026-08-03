# Signing and notarizing the macOS build

By default `npm run package:mac` produces an **unsigned** DMG/ZIP — this is
still the case if you do nothing described below. Signing and notarization are
entirely opt-in and controlled by three environment variables read from your
own shell; nothing here is wired into CI or committed to the repository.

This is a one-time setup on your own Mac. You need an Apple Developer Program
membership, which costs $99/year.

## 1. Enroll in the Apple Developer Program

Go to <https://developer.apple.com/programs/> and enroll (individual or
organization). This is a paid, Apple-administered signup — nothing here can do
it for you.

## 2. Create a Developer ID Application certificate

This is the certificate that signs software distributed outside the Mac App
Store, which is how KubeDeck ships.

Easiest path, using Xcode:

1. Open Xcode → Settings → Accounts, sign in with your Apple ID.
2. Select your team → Manage Certificates → `+` → **Developer ID Application**.

Xcode installs the certificate straight into your login keychain.

Without Xcode, via Keychain Access + the Apple Developer portal:

1. Keychain Access → Certificate Assistant → Request a Certificate From a
   Certificate Authority, save the CSR to disk.
2. <https://developer.apple.com/account/resources/certificates/list> → `+` →
   **Developer ID Application** → upload the CSR → download the resulting
   `.cer`.
3. Double-click the downloaded `.cer` to install it into your login keychain.

Confirm it's there:

```bash
security find-identity -v -p codesigning
```

You should see a line like
`"Developer ID Application: Your Name (TEAMID1234)"`.

## 3. Create a notarization credential

Notarization uses your Apple ID plus an **app-specific password** (not your
main Apple ID password):

1. Sign in at <https://appleid.apple.com/> → Sign-In and Security →
   App-Specific Passwords → generate one, label it e.g. `kubedeck-notarize`.
2. Save it somewhere you control (a password manager, not this repo).

## 4. Find your Team ID

<https://developer.apple.com/account> → Membership details → **Team ID**
(a 10-character alphanumeric string, also visible in the identity string from
step 2).

## 5. Build signed and notarized

Export the three variables in your shell (not into any file inside the repo)
and run the normal packaging command:

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID1234"
npm run package:mac
```

`scripts/build-macos.sh` detects `APPLE_TEAM_ID` and switches from the default
unsigned path to: sign with the Developer ID Application identity already in
your keychain (electron-builder auto-discovers it — no certificate file or
password ever needs to be typed anywhere), then notarize via Apple's
`notarytool` (built into `electron-builder`), then verify the result with
`codesign --verify`, `spctl -a -t exec` and `xcrun stapler validate` before
declaring the build done. Any of these failing stops the script with a clear
error instead of shipping a build that merely looks signed.

Leave the three variables unset and the script produces the exact same
unsigned build as before — this workflow never becomes mandatory.

## Notes

- The certificate lives in your login keychain, not in a file in this repo.
  `.gitignore` also blocks `*.p12` / `*.cer` / `*.mobileprovision` as a second
  line of defense if you ever export one into the working tree.
- Developer ID Application certificates are renewable, not permanent — Apple
  will prompt you to renew before expiry.
- Notarization requires network access to Apple's servers during the build
  and can take anywhere from under a minute to several minutes.
