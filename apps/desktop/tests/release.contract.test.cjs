const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const readJson = (relativePath) =>
  JSON.parse(read(relativePath).replace(/^\uFEFF/, ""));

test("KubeDeck 2.0.5 release metadata stays synchronized", () => {
  const expectedVersion = "2.0.5";
  const rootPackage = readJson("package.json");
  const desktopPackage = readJson("apps/desktop/package.json");
  const lock = readJson("package-lock.json");
  const readme = read("README.md");
  const progress = read("NODE_MIGRATION_PROGRESS.md");
  const notes = read("RELEASE_NOTES_2.0.5.md");
  const checklist = read("REGRESSION_CHECKLIST_2.0.5.md");

  assert.equal(rootPackage.version, expectedVersion);
  assert.equal(desktopPackage.version, expectedVersion);
  assert.equal(lock.version, expectedVersion);
  assert.equal(lock.packages[""].version, expectedVersion);
  assert.equal(lock.packages["apps/desktop"].version, expectedVersion);
  assert.match(rootPackage.scripts["verify:release"], /verify-release\.ps1/);
  assert.match(desktopPackage.scripts["test:gateway"], /--test-concurrency=1/);
  assert.match(
    desktopPackage.scripts["test:gateway"],
    /release\.contract\.test\.cjs/,
  );

  for (const document of [readme, progress, notes, checklist]) {
    assert.match(document, /2\.0\.5/);
  }

  assert.match(notes, /Node-only/);
  assert.match(notes, /49/);
  assert.match(checklist, /Node 49 \/ Python 0/);
  assert.match(checklist, /Port Forward/);
  assert.match(checklist, /LLM/);
});
