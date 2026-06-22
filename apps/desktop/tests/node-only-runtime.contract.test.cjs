const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

test("KubeDeck runtime is Node-only after Alpha 14 cleanup", () => {
  const mainSource = read("apps/desktop/src/main/main.ts");
  const gatewaySource = read("apps/desktop/src/main/backend/gateway.ts");
  const yamlSource = read("apps/desktop/src/main/backend/routes/yaml.ts");
  const migrationSource = read(
    "apps/desktop/src/main/backend/routes/migrationStatus.ts",
  );
  const builderSource = read("scripts/build-portable-windows.ps1");
  const electronBuilder = read("apps/desktop/electron-builder.yml");
  const desktopPackage = JSON.parse(read("apps/desktop/package.json"));
  const { routeOwnershipSummary } = require(
    "../dist/main/backend/routeOwnership.js"
  );

  assert.equal(fs.existsSync(path.join(repoRoot, "apps/backend")), false);
  assert.equal(
    fs.existsSync(
      path.join(repoRoot, "apps/desktop/src/main/backend/legacyProxy.ts"),
    ),
    false,
  );

  assert.doesNotMatch(
    mainSource,
    /startBackend|waitForBackendReady|kubedeck_backend|KUBEDECK_BACKEND_PORT|legacyBackendUrl|backend\.pid/,
  );
  assert.doesNotMatch(mainSource, /node:child_process|node:net/);

  assert.doesNotMatch(
    gatewaySource,
    /legacyProxy|legacyBackendUrl|legacyProcessId|proxyHttpRequest|proxyWebSocketUpgrade|invalidateLegacyResourceCache/,
  );
  assert.doesNotMatch(yamlSource, /invalidateLegacyResourceCache/);

  assert.match(migrationSource, /mode:\s*"node-only"/);
  assert.match(migrationSource, /enabled:\s*false/);
  assert.match(migrationSource, /source:\s*"node"/);

  assert.doesNotMatch(
    builderSource,
    /-m\s+PyInstaller|pip\s+install|requirements\.txt|requirements\.lock\.txt|Assert-Command\s+-Name\s+"py"|apps[\\/]backend/,
  );
  assert.doesNotMatch(
    electronBuilder,
    /build[\\/]backend|to:\s*backend|extraResources:/,
  );

  const ownership = routeOwnershipSummary();
  assert.equal(ownership.totalExisting, 49);
  assert.equal(ownership.nodeOwned, 49);
  assert.equal(ownership.pythonOwned, 0);
  assert.equal(desktopPackage.version, "2.0.0-alpha.14");
});
