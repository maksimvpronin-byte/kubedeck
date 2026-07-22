const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const readJson = (relativePath) => JSON.parse(read(relativePath).replace(/^\uFEFF/, ""));
const { normalizeSettings } = require("../dist/main/backend/config/configStore.js");

test("stored theme values remain backward compatible", () => {
  assert.equal(normalizeSettings({ theme: "dark" }).theme, "midnight");
  assert.equal(normalizeSettings({ theme: "not-a-theme" }).theme, "midnight");
  assert.equal(normalizeSettings({ theme: "light" }).theme, "light");
});

test("KubeDeck release metadata stays synchronized", () => {
  const rootPackage = readJson("package.json");
  const expectedVersion = rootPackage.version;
  const contract = readJson("release-contract.json");
  const desktopPackage = readJson("apps/desktop/package.json");
  const lock = readJson("package-lock.json");
  const readme = read("README.md");
  const progress = read("NODE_MIGRATION_PROGRESS.md");
  const notes = read(`RELEASE_NOTES_${expectedVersion}.md`);
  const checklist = read(`REGRESSION_CHECKLIST_${expectedVersion}.md`);
  const windowsVersionScript = read("scripts/set-version.ps1");
  const attributes = read(".gitattributes");

  assert.equal(rootPackage.version, expectedVersion);
  assert.equal(desktopPackage.version, expectedVersion);
  assert.equal(lock.version, expectedVersion);
  assert.equal(lock.packages[""].version, expectedVersion);
  assert.equal(lock.packages["apps/desktop"].version, expectedVersion);
  assert.match(rootPackage.scripts["verify:release"], /verify-release\.cjs/);
  assert.match(desktopPackage.scripts["test:gateway"], /--test-concurrency=1/);
  assert.match(desktopPackage.scripts["test:gateway"], /release\.contract\.test\.cjs/);

  for (const document of [readme, progress, notes, checklist]) {
    assert.ok(document.includes(expectedVersion));
  }

  assert.match(notes, /Node-only/);
  assert.match(notes, /51/);
  assert.match(checklist, /Node 51 \/ Python 0/);
  assert.match(checklist, /cluster/i);
  assert.match(checklist, /LLM/);
  assert.equal(contract.nodeRoutes, 51);
  assert.equal(contract.pythonRoutes, 0);
  assert.match(windowsVersionScript, /vite\.config\.mts/);
  assert.doesNotMatch(windowsVersionScript, /packages\\ui|apps\\backend|vite\.config\.ts/);
  assert.match(attributes, /^\* text=auto eol=lf$/m);
  assert.match(attributes, /^\*\.ps1 text eol=crlf$/m);
  assert.match(attributes, /^\*\.sh text eol=lf$/m);
});
