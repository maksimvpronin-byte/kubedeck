const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const readJson = (relativePath) => JSON.parse(read(relativePath).replace(/^﻿/, ""));
const { signingPlan } = require("../scripts/electron-after-pack.cjs");

function packContext(platform) {
  return {
    electronPlatformName: platform,
    appOutDir: "/tmp/kubedeck-out",
    packager: { appInfo: { productFilename: "KubeDeck" } },
  };
}

// An unsigned arm64 application does not start at all - the kernel refuses it,
// and macOS reports a perfectly good download as damaged. electron-builder
// signs nothing when no identity is configured, so the afterPack hook signs
// ad-hoc instead; the decision is split out of the hook so it can be tested
// without a Mac and without a build.
test("macOS is signed ad-hoc only when nothing else will sign it", () => {
  assert.equal(signingPlan(packContext("win32"), { CSC_IDENTITY_AUTO_DISCOVERY: "false" }), null);
  assert.equal(signingPlan(packContext("linux"), { CSC_IDENTITY_AUTO_DISCOVERY: "false" }), null);

  // A certificate was handed to the build: electron-builder signs it properly
  // and re-signing here would throw that away.
  assert.equal(signingPlan(packContext("darwin"), { CSC_LINK: "certificate.p12" }), null);
  // An identity may be waiting in the keychain. build-macos.sh turns
  // auto-discovery off only once it has decided the build is unsigned.
  assert.equal(signingPlan(packContext("darwin"), {}), null);

  const plan = signingPlan(packContext("darwin"), { CSC_IDENTITY_AUTO_DISCOVERY: "false" });
  assert.ok(plan, "an unsigned macOS build must be signed ad-hoc");
  assert.equal(plan.command, "codesign");
  assert.deepEqual(plan.args, ["--force", "--deep", "--sign", "-", "/tmp/kubedeck-out/KubeDeck.app"]);
});

// release contract: asserts on the shape of a release, which has no behaviour.
test("a tagged release is built by three runners and published by one", () => {
  const workflow = read(".github/workflows/release.yml");
  const desktopPackage = readJson("apps/desktop/package.json");

  assert.match(workflow, /tags:\n\s+- 'v\*'/);
  // The tag is checked before anything is built, by a job that installs
  // nothing: half an hour of packaging should not be spent to discover that the
  // tag and the version disagree.
  assert.match(workflow, /node scripts\/verify-release\.cjs --tag "\$GITHUB_REF_NAME"/);
  assert.match(workflow, /needs: guard/);

  for (const script of ["package:mac", "package:win", "package:linux"]) {
    assert.match(workflow, new RegExp(`script: ${script.replace(":", ":")}`), `${script} must run on its own runner`);
  }
  // The same scripts a release is built with by hand, so CI and a desk cannot
  // drift apart.
  const rootPackage = readJson("package.json");
  assert.match(rootPackage.scripts["package:mac"], /build-macos\.sh/);
  assert.match(rootPackage.scripts["package:linux"], /build-linux\.sh/);
  assert.match(rootPackage.scripts["package:win"], /build-portable-windows\.ps1/);

  // Nothing uploads from a packaging run. electron-builder looks a release up
  // by tag, a draft has no published tag, and every publish that asks is told
  // there is none and creates a draft of its own.
  for (const script of ["dist:win", "dist:mac", "dist:linux"]) {
    assert.match(desktopPackage.scripts[script], /--publish never/);
  }
  assert.match(workflow, /needs: build/);
  assert.match(workflow, /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /--draft/);
  // Release notes are written, not generated: the tag before this system
  // existed is v2.0.0-beta.1.
  assert.match(workflow, /--notes-file "\$notes"/);
  // Without latest*.yml a release is one nobody is ever offered.
  assert.match(workflow, /latest\.yml latest-mac\.yml latest-linux\.yml/);
});

// release contract: asserts on the shape of a release, which has no behaviour.
test("the application asks for updates and downloads none unasked", () => {
  const updates = read("apps/desktop/src/main/updates.ts");
  const main = read("apps/desktop/src/main/main.ts");
  const preload = read("apps/desktop/src/preload/preload.ts");
  const about = read("apps/desktop/src/renderer/components/AboutPanel.tsx");

  assert.match(updates, /autoUpdater\.autoDownload = false/);
  assert.match(updates, /https:\/\/github\.com\/maksimvpronin-byte\/kubedeck\/releases/);
  // A build that cannot replace itself is told so and pointed at the release
  // page, rather than spending a couple of hundred megabytes to fail at the
  // last step: the Windows portable exe has no installation to replace, and
  // Squirrel refuses an unsigned macOS bundle.
  assert.match(updates, /PORTABLE_EXECUTABLE_DIR/);
  assert.match(updates, /Authority=Developer ID Application/);
  // The gateway holds ports, watches and - on Windows - the files the installer
  // is about to replace.
  assert.match(updates, /await prepareForRestart\(\);\n\s+autoUpdater\.quitAndInstall\(\)/);

  for (const channel of ["getUpdateState", "checkForUpdates", "downloadUpdate", "installUpdate", "openReleases"]) {
    assert.match(main, new RegExp(`kubedeck:${channel}`), `main must handle kubedeck:${channel}`);
    assert.match(preload, new RegExp(`kubedeck:${channel}`), `preload must expose kubedeck:${channel}`);
  }
  // Every visit to About subscribes; without the disposer every visit also
  // leaves a listener behind.
  assert.match(preload, /removeListener\("kubedeck:updateState"/);
  assert.match(about, /window\.kubedeck\.onUpdateState/);
  assert.match(about, /window\.kubedeck\.checkForUpdates\(\)/);

  const english = readJson("apps/desktop/src/renderer/locales/en.json");
  const russian = readJson("apps/desktop/src/renderer/locales/ru.json");
  for (const locale of [english, russian]) {
    for (const key of [
      "about.updates",
      "about.updateCheck",
      "about.updateDownload",
      "about.updateInstall",
      "about.updateReleases",
      "about.update.reason.portable",
      "about.update.reason.unsigned",
      "about.update.reason.development",
    ]) {
      assert.ok(locale[key], `${key} must be translated`);
    }
  }
});
