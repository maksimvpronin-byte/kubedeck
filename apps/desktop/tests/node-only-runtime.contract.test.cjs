const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const forbiddenRuntimePattern =
  /startBackend|waitForBackendReady|kubedeck_backend|KUBEDECK_BACKEND_PORT|legacyBackendUrl|legacyProcessId|legacyProxy|proxyHttpRequest|proxyWebSocketUpgrade|invalidateLegacyResourceCache|clearLegacyResourceCache|backend\.pid|resources[\\/]backend/;

test("KubeDeck release keeps the runtime and build pipeline Node-only", () => {
  const rootPackage = JSON.parse(read("package.json").replace(/^\uFEFF/, ""));
  const desktopPackage = JSON.parse(
    read("apps/desktop/package.json").replace(/^\uFEFF/, ""),
  );
  const mainSource = read("apps/desktop/src/main/main.ts");
  const gatewaySource = read("apps/desktop/src/main/backend/gateway.ts");
  const migrationSource = read(
    "apps/desktop/src/main/backend/routes/migrationStatus.ts",
  );
  const clustersSource = read(
    "apps/desktop/src/main/backend/routes/clusters.ts",
  );
  const yamlSource = read("apps/desktop/src/main/backend/routes/yaml.ts");
  const builderSource = read("scripts/build-portable-windows.ps1");
  const verifierSource = read("scripts/verify-node-only.ps1");
  const setupSource = read("scripts/setup-windows.ps1");
  const electronBuilder = read("apps/desktop/electron-builder.yml");
  const readme = read("README.md");
  const { routeOwnershipSummary } = require(
    "../dist/main/backend/routeOwnership.js",
  );

  assert.equal(rootPackage.version, "2.1.0");
  assert.equal(desktopPackage.version, "2.1.0");
  assert.match(rootPackage.scripts["verify:node-only"], /verify-node-only\.ps1/);
  assert.match(rootPackage.scripts["verify:release"], /verify-release\.ps1/);
  assert.match(
    desktopPackage.scripts["test:gateway"],
    /--test-concurrency=1/,
  );
  assert.match(
    desktopPackage.scripts["test:gateway"],
    /node-only-runtime\.contract\.test\.cjs/,
  );

  assert.equal(fs.existsSync(path.join(repoRoot, "apps/backend")), false);
  assert.equal(
    fs.existsSync(
      path.join(repoRoot, "apps/desktop/src/main/backend/legacyProxy.ts"),
    ),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(repoRoot, "apps/desktop/src/main/backend/legacyControl.ts"),
    ),
    false,
  );

  for (const source of [
    mainSource,
    gatewaySource,
    migrationSource,
    clustersSource,
    yamlSource,
  ]) {
    assert.doesNotMatch(source, forbiddenRuntimePattern);
  }

  assert.match(migrationSource, /mode:\s*["']node-only["']/);
  assert.match(migrationSource, /source:\s*["']node["']/);
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.match(mainSource, /sandbox:\s*true/);
  assert.match(mainSource, /will-navigate/);
  assert.doesNotMatch(
    builderSource,
    /PyInstaller|pip\s+install|requirements\.txt|apps[\\/]backend|\.build-venv|\bpy\s+-3\b/,
  );
  assert.match(builderSource, /verify-node-only\.ps1/);
  assert.doesNotMatch(
    setupSource,
    /Python\.Python|pip\s+install|apps[\\/]backend|\bpy\s+-3\b/,
  );
  assert.doesNotMatch(electronBuilder, /build[\\/]backend|to:\s*backend/);
  assert.match(verifierSource, /Route ownership: Node 49 \/ Python 0/);
  assert.match(readme, /2\.1\.0/);
  assert.match(readme, /Node-only runtime/);
  assert.doesNotMatch(
    readme,
    /pip\s+install|apps[\\/]backend[\\/](?:requirements\.txt|kubedeck_backend|main\.py)/,
  );

  const ownership = routeOwnershipSummary();
  assert.equal(ownership.totalExisting, 49);
  assert.equal(ownership.nodeOwned, 49);
  assert.equal(ownership.pythonOwned, 0);
});
