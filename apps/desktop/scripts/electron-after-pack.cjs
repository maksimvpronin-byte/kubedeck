const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function macAppBundle(context) {
  if (!context.appOutDir) return "";
  return path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
}

// node-pty forks through a helper binary, and the executable bit does not
// survive being carried inside app.asar.unpacked. Without it the terminal opens
// and immediately dies with EACCES.
function repairSpawnHelper(appBundle) {
  const resourcesDir = path.join(appBundle, "Contents", "Resources");
  for (const arch of ["darwin-arm64", "darwin-x64"]) {
    const helper = path.join(resourcesDir, "app.asar.unpacked", "node_modules", "node-pty", "prebuilds", arch, "spawn-helper");
    if (fs.existsSync(helper)) {
      fs.chmodSync(helper, 0o755);
    }
  }
}

// Signs the bundle with nothing in particular, when there is nothing to sign it
// with.
//
// An unsigned build is not merely unverified: on Apple Silicon it does not
// start at all. Every arm64 executable has to carry a signature for the kernel
// to run it, an ad-hoc one counts, and electron-builder skips signing entirely
// when no identity is configured. macOS then reports a perfectly good download
// as "KubeDeck is damaged and can't be opened", which reads as a corrupt file
// and is nothing of the kind. It never bit while the DMG was carried from the
// machine that built it; it bites the moment the DMG is downloaded from a
// release.
//
// An ad-hoc signature fixes the launch and nothing else. Gatekeeper still knows
// nobody vouched for the application and still asks - but it asks the ordinary
// question, with "Open Anyway" behind it, instead of telling people to move a
// working download to the Trash. The real answer is a Developer ID certificate
// and notarization; see docs/macos-signing.md. This is what a build without one
// can do.
//
// `--deep` is deprecated by Apple and is right here anyway: the reason to sign
// each nested binary separately is to give each its own entitlements, and an
// ad-hoc signature has none to give. The Electron helpers, node-pty's
// spawn-helper and its native module all need a signature of some kind, and
// this is the one command that reaches all of them.
exports.signingPlan = function signingPlan(context, env) {
  if (context.electronPlatformName !== "darwin") return null;
  // A certificate is configured, so electron-builder signs the bundle properly
  // and re-signing it here would throw that away. Both forms count: CSC_LINK is
  // a certificate handed to the build, and identity auto-discovery left on is
  // one waiting in the keychain - build-macos.sh only turns it off when it has
  // decided the build is unsigned.
  if (env.CSC_LINK) return null;
  if (env.CSC_IDENTITY_AUTO_DISCOVERY !== "false") return null;

  const appBundle = macAppBundle(context);
  if (!appBundle) return null;
  return { command: "codesign", args: ["--force", "--deep", "--sign", "-", appBundle], appBundle };
};

exports.default = async function afterPack(context) {
  // Only macOS keeps the unpacked helper inside a .app bundle. Windows and Linux
  // builds have nothing to repair here, so they must not build a bogus path.
  if (context.electronPlatformName !== "darwin") return;

  const appBundle = macAppBundle(context);
  if (!appBundle) return;
  // Before signing, not after: a signature is taken over the bundle as it
  // stands, and repairing a file underneath one invalidates it.
  repairSpawnHelper(appBundle);

  const plan = exports.signingPlan(context, process.env);
  if (!plan) return;
  execFileSync(plan.command, plan.args, { stdio: "inherit" });
  process.stdout.write(`  • signed ad-hoc  reason=no certificate configured, file=${plan.appBundle}\n`);
};
