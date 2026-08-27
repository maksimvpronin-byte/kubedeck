const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const readJson = (relativePath) => JSON.parse(read(relativePath).replace(/^\uFEFF/, ""));
const readBuffer = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath));
const { normalizeSettings } = require("../dist/main/backend/config/configStore.js");

test("stored theme values remain backward compatible", () => {
  assert.equal(normalizeSettings({ theme: "dark" }).theme, "midnight");
  assert.equal(normalizeSettings({ theme: "not-a-theme" }).theme, "midnight");
  assert.equal(normalizeSettings({ theme: "light" }).theme, "light");
  assert.equal(normalizeSettings({ theme: "graphite" }).theme, "graphite");
});

test("Windows packaging uses a committed multi-size ICO", () => {
  const builderConfig = read("apps/desktop/electron-builder.yml");
  const windowsIcon = readBuffer("apps/desktop/assets/icon.ico");

  assert.match(builderConfig, /win:\n\s+icon: assets\/icon\.ico/);
  assert.equal(windowsIcon.readUInt16LE(0), 0);
  assert.equal(windowsIcon.readUInt16LE(2), 1);
  assert.ok(windowsIcon.readUInt16LE(4) >= 6);
});

test("the running application carries the KubeDeck icon, not the Electron default", () => {
  const builderConfig = read("apps/desktop/electron-builder.yml");
  const main = read("apps/desktop/src/main/main.ts");

  // The icon has to be inside the payload, otherwise the window cannot load it.
  assert.match(builderConfig, /files:[\s\S]*?- assets\/icon\.ico/);
  assert.match(builderConfig, /files:[\s\S]*?- assets\/icon-512\.png/);
  // rcedit must stay enabled so the packaged executable keeps icon and version info.
  assert.match(builderConfig, /signAndEditExecutable: true/);

  assert.match(main, /nativeImage\.createFromPath/);
  assert.match(main, /resolveWindowIcon\(\)/);
  assert.match(main, /\.\.\/\.\.\/assets/);
  assert.match(main, /setAppUserModelId\("dev\.kubedeck\.app"\)/);
  assert.match(builderConfig, /appId: dev\.kubedeck\.app/);
});

test("KubeDeck release metadata stays synchronized", () => {
  const rootPackage = readJson("package.json");
  const expectedVersion = rootPackage.version;
  const contract = readJson("release-contract.json");
  const desktopPackage = readJson("apps/desktop/package.json");
  const sharedPackage = readJson("packages/shared-types/package.json");
  const lock = readJson("package-lock.json");
  const readme = read("README.md");
  const readmeRu = read("README.ru.md");
  const notes = read(`docs/releases/RELEASE_NOTES_${expectedVersion}.md`);
  const checklist = read(`docs/releases/REGRESSION_CHECKLIST_${expectedVersion}.md`);
  const helpPanel = read("apps/desktop/src/renderer/components/HelpPanel.tsx");
  const windowsVersionScript = read("scripts/set-version.ps1");
  const attributes = read(".gitattributes");

  assert.equal(rootPackage.version, expectedVersion);
  assert.equal(desktopPackage.version, expectedVersion);
  assert.equal(sharedPackage.version, expectedVersion);
  assert.equal(desktopPackage.dependencies["@kubedeck/shared-types"], expectedVersion);
  assert.equal(lock.version, expectedVersion);
  assert.equal(lock.packages[""].version, expectedVersion);
  assert.equal(lock.packages["apps/desktop"].version, expectedVersion);
  assert.match(rootPackage.scripts["verify:release"], /verify-release\.cjs/);
  assert.match(desktopPackage.scripts["test:gateway"], /--test-concurrency=1/);
  assert.match(desktopPackage.scripts["test:gateway"], /release\.contract\.test\.cjs/);

  // Driven by the contract rather than a hand-kept list: the packaging
  // verifier walks `requiredDocuments`, and a document listed there but missing
  // here passed the gate and failed the build instead.
  assert.ok(contract.requiredDocuments.length > 0, "the contract must name the documents a release has to update");
  for (const entry of contract.requiredDocuments) {
    const documentPath = entry.replace("{version}", expectedVersion);
    assert.ok(read(documentPath).includes(expectedVersion), `${documentPath} must mention ${expectedVersion}`);
  }

  for (const document of [readme, readmeRu]) {
    assert.ok(document.includes(`docs/releases/RELEASE_NOTES_${expectedVersion}.md`));
    assert.ok(document.includes(`docs/releases/REGRESSION_CHECKLIST_${expectedVersion}.md`));
  }
  assert.match(helpPanel, /getDesktopInfo\(\)/);
  assert.match(helpPanel, /appVersion/);
  assert.doesNotMatch(helpPanel, /<dd>\d+\.\d+\.\d+<\/dd>/);
  assert.match(notes, /Node-only/);
  assert.match(notes, /59/);
  assert.match(checklist, /Node 59 \/ Python 0/);
  assert.match(checklist, /cluster/i);
  assert.match(checklist, /LLM/);
  assert.equal(contract.nodeRoutes, 59);
  assert.equal(contract.pythonRoutes, 0);
  assert.match(windowsVersionScript, /vite\.config\.mts/);
  assert.doesNotMatch(windowsVersionScript, /packages\\ui|apps\\backend|vite\.config\.ts/);
  assert.match(attributes, /^\* text=auto eol=lf$/m);
  assert.match(attributes, /^\*\.ps1 text eol=crlf$/m);
  assert.match(attributes, /^\*\.sh text eol=lf$/m);
});
