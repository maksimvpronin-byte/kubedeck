#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

function argument(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : "";
}

function read(relativePath) {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target)) throw new Error(`Required file is missing: ${relativePath}`);
  return fs.readFileSync(target, "utf8").replace(/^\uFEFF/, "");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function ok(message) {
  process.stdout.write(`[OK] ${message}\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoPattern(relativePath, patterns, description) {
  const text = read(relativePath);
  for (const pattern of patterns) {
    if (pattern.test(text)) throw new Error(`${description}. Pattern ${pattern} found in ${relativePath}`);
  }
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(target));
    else result.push(target);
  }
  return result;
}

function verifyVersions() {
  const rootPackage = readJson("package.json");
  const desktopPackage = readJson("apps/desktop/package.json");
  const sharedPackage = readJson("packages/shared-types/package.json");
  const lock = readJson("package-lock.json");
  const version = rootPackage.version;
  const versions = [
    desktopPackage.version,
    sharedPackage.version,
    lock.version,
    lock.packages?.[""]?.version,
    lock.packages?.["apps/desktop"]?.version,
    lock.packages?.["packages/shared-types"]?.version,
  ];
  assert(
    versions.every((candidate) => candidate === version),
    `Version mismatch: expected ${version}; found ${versions.join(", ")}`,
  );
  assert(desktopPackage.dependencies?.["@kubedeck/shared-types"] === version, `Desktop shared-types dependency must match release version ${version}`);
  assert(
    rootPackage.scripts?.verify === "npm run lint && npm run format:check && npm run test:renderer && npm run typecheck && npm run build && npm --workspace apps/desktop run test:gateway",
    "Root verify gate changed unexpectedly",
  );
  assert(/--test-concurrency=1/.test(desktopPackage.scripts?.["test:gateway"] ?? ""), "Gateway tests must remain deterministic");
  ok(`Version consistency: ${version}`);
  return { version, rootPackage, desktopPackage };
}

function verifyNodeOnly(contract, desktopPackage) {
  for (const forbidden of ["apps/backend", "apps/desktop/src/main/backend/legacyProxy.ts", "apps/desktop/src/main/backend/legacyControl.ts"]) {
    assert(!fs.existsSync(path.join(root, forbidden)), `Forbidden legacy path exists: ${forbidden}`);
  }
  const legacyPatterns = [
    /startBackend/,
    /waitForBackendReady/,
    /kubedeck_backend/,
    /KUBEDECK_BACKEND_PORT/,
    /legacyBackendUrl/,
    /legacyProcessId/,
    /legacyProxy/,
    /proxyHttpRequest/,
    /proxyWebSocketUpgrade/,
    /invalidateLegacyResourceCache/,
    /clearLegacyResourceCache/,
    /backend\.pid/,
    /resources[\\/]backend/,
  ];
  for (const file of [
    "apps/desktop/src/main/main.ts",
    "apps/desktop/src/main/backend/gateway.ts",
    "apps/desktop/src/main/backend/routes/migrationStatus.ts",
    "apps/desktop/src/main/backend/routes/clusters.ts",
    "apps/desktop/src/main/backend/routes/yaml.ts",
  ])
    assertNoPattern(file, legacyPatterns, "Legacy runtime code is forbidden");

  const ownership = read("apps/desktop/src/main/backend/routeOwnership.ts");
  const nodeRoutes = (ownership.match(/owner\s*:\s*["']node["']/g) ?? []).length;
  const pythonRoutes = (ownership.match(/owner\s*:\s*["']python["']/g) ?? []).length;
  assert(
    nodeRoutes === contract.nodeRoutes && pythonRoutes === contract.pythonRoutes,
    `Route ownership mismatch: Node=${nodeRoutes}, Python=${pythonRoutes}; expected ${contract.nodeRoutes}/${contract.pythonRoutes}`,
  );
  assert(/node-only-runtime\.contract\.test\.cjs/.test(desktopPackage.scripts?.["test:gateway"] ?? ""), "Gateway suite is missing node-only runtime contract");
  assertNoPattern(
    "scripts/build-portable-windows.ps1",
    [/PyInstaller/, /pip\s+install/, /requirements\.txt/, /apps[\\/]backend/, /\.build-venv/, /\bpy\s+-3\b/],
    "Windows builder must remain Node-only",
  );
  assertNoPattern("apps/desktop/electron-builder.yml", [/build[\\/]backend/, /to\s*:\s*backend/], "electron-builder must not bundle Python backend");
  const builder = read("scripts/build-portable-windows.ps1");
  const macBuilder = read("scripts/build-macos.sh");
  const electronBuilder = read("apps/desktop/electron-builder.yml");
  assert(/electron-rebuild/.test(builder) && /node-pty/.test(builder), "Windows builder must rebuild node-pty");
  assert(/node_modules\/node-pty/.test(electronBuilder) && /afterPack/.test(electronBuilder), "electron-builder must unpack and repair node-pty");
  assert(/spawn-helper/.test(macBuilder) && /chmod 755/.test(macBuilder), "macOS builder must repair spawn-helper permissions");
  ok(`Node-only ownership: Node ${nodeRoutes} / Python ${pythonRoutes}`);
}

function verifyDocuments(contract, version) {
  for (const template of contract.requiredDocuments) {
    const relativePath = template.replace("{version}", version);
    const content = read(relativePath);
    assert(content.includes(version), `${relativePath} does not mention ${version}`);
  }
  for (const relativePath of ["README.md", "README.ru.md"]) {
    const content = read(relativePath);
    assert(content.includes(`docs/releases/RELEASE_NOTES_${version}.md`), `${relativePath} has a stale release-notes link`);
    assert(content.includes(`docs/releases/REGRESSION_CHECKLIST_${version}.md`), `${relativePath} has a stale regression-checklist link`);
  }
  const helpPanel = read("apps/desktop/src/renderer/components/HelpPanel.tsx");
  assert(/getDesktopInfo\(\)/.test(helpPanel) && /appVersion/.test(helpPanel), "Help must read the packaged application version");
  assert(!/<dd>\d+\.\d+\.\d+<\/dd>/.test(helpPanel), "Help must not contain a hardcoded application version");
  ok("Release documents are present and versioned");
}

function verifyLicensing() {
  const license = read("LICENSE");
  assert(/^\s*Apache License\s*$/m.test(license), "LICENSE must contain the Apache License text");
  assert(/Version 2\.0, January 2004/.test(license), "LICENSE must be Apache License 2.0");
  assert(/END OF TERMS AND CONDITIONS/.test(license), "LICENSE must contain the full Apache License text");

  const notice = read("NOTICE");
  assert(/Copyright \d{4}/.test(notice), "NOTICE must declare a copyright year and holder");
  assert(/Trademarks/.test(notice), "NOTICE must reserve the KubeDeck name and icons");

  for (const relativePath of ["package.json", "apps/desktop/package.json", "packages/shared-types/package.json"]) {
    assert(readJson(relativePath).license === "Apache-2.0", `${relativePath} must declare the Apache-2.0 license`);
  }

  const notices = read("docs/third-party-notices.md");
  const desktopPackage = readJson("apps/desktop/package.json");
  for (const name of Object.keys(desktopPackage.dependencies ?? {})) {
    if (name.startsWith("@kubedeck/")) continue;
    assert(notices.includes(`\`${name}\``), `docs/third-party-notices.md is missing production dependency ${name}`);
  }

  for (const relativePath of ["README.md", "README.ru.md"]) {
    assert(read(relativePath).includes("(./LICENSE)"), `${relativePath} must link to LICENSE`);
  }
  ok("Licensing: Apache-2.0, NOTICE and third-party notices");
}

function verifyArtifactVersioning(version) {
  const builder = read("apps/desktop/electron-builder.yml");
  assert(builder.includes("artifactName: ${productName}-${version}-${arch}.${ext}"), "macOS artifact name must use the package version");
  assert(builder.includes("artifactName: ${productName}-Portable-${version}-${arch}.${ext}"), "Windows portable artifact name must use the package version");
  assert(/^appImage:\s*$/m.test(builder) && /^linux:\s*$/m.test(builder), "electron-builder must define a Linux AppImage target");
  ok(`Cross-platform artifact versioning: ${version}`);
}

function verifyLineEndingPolicy() {
  const attributes = read(".gitattributes");
  assert(/^\* text=auto eol=lf$/m.test(attributes), "Source files must use LF on every platform");
  for (const extension of ["bat", "cmd", "ps1"]) {
    assert(new RegExp(`^\\*\\.${extension} text eol=crlf$`, "m").test(attributes), `*.${extension} must use CRLF`);
  }
  assert(/^\*\.sh text eol=lf$/m.test(attributes), "Shell scripts must use LF");
  ok("Cross-platform line-ending policy");
}

function verifyMacSignature(appBundle) {
  const result = spawnSync("codesign", ["-dv", "--verbose=4", appBundle], { encoding: "utf8" });
  assert(result.status === 0, `codesign could not inspect ${appBundle}: ${result.stderr || result.error}`);
  const info = `${result.stdout}${result.stderr}`;
  assert(/Authority=Developer ID Application/.test(info), `macOS app is not signed with a Developer ID Application identity: ${appBundle}`);
  assert(!/adhoc/i.test(info), `macOS app is only ad-hoc signed: ${appBundle}`);
}

function verifyReleasePayload(releaseDir, artifact, version, signed) {
  if (!releaseDir) return;
  const resolved = path.resolve(root, releaseDir);
  assert(fs.existsSync(resolved), `Release directory does not exist: ${resolved}`);
  const forbiddenNames = /^(?:kubectl\.exe|KubeDeck Backend\.exe|kubedeck-backend\.exe|pythonw?\.exe|python\d*\.dll)$/i;
  for (const target of walk(resolved)) {
    assert(!forbiddenNames.test(path.basename(target)), `Forbidden release payload: ${target}`);
    assert(!/[\\/]resources[\\/]backend(?:[\\/]|$)/i.test(target), `Forbidden backend payload: ${target}`);
  }
  if (artifact === "windows") {
    assert(fs.existsSync(path.join(resolved, `KubeDeck-Portable-${version}-x64.exe`)), "Windows portable artifact is missing");
  }
  if (artifact === "mac") {
    assert(fs.existsSync(path.join(resolved, `KubeDeck-${version}-arm64.dmg`)), "macOS DMG artifact is missing");
    assert(
      walk(resolved).some((target) => path.basename(target).startsWith(`KubeDeck-${version}-arm64`) && target.endsWith(".zip")),
      "macOS ZIP artifact is missing",
    );
    const helper = path.join(resolved, "mac-arm64/KubeDeck.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper");
    assert(fs.existsSync(helper) && (fs.statSync(helper).mode & 0o111) !== 0, "Packaged macOS spawn-helper is missing or not executable");
    if (signed) {
      verifyMacSignature(path.join(resolved, "mac-arm64/KubeDeck.app"));
    }
  }
  if (artifact === "linux") {
    // electron-builder names AppImage artifacts with the Linux arch spelling
    // (x86_64), not the electron-builder arch flag (x64).
    const image = walk(resolved).find((target) => {
      const name = path.basename(target);
      return name.startsWith(`KubeDeck-${version}-`) && name.endsWith(".AppImage");
    });
    assert(image, "Linux AppImage artifact is missing");
    assert((fs.statSync(image).mode & 0o111) !== 0, "Linux AppImage must be executable");
    const unpacked = path.join(resolved, "linux-unpacked/resources/app.asar.unpacked/node_modules/node-pty");
    assert(fs.existsSync(unpacked), "Packaged Linux build is missing the unpacked node-pty module");
  }
  ok(`Release payload validated${artifact ? ` for ${artifact}` : ""}`);
}

try {
  const contract = readJson("release-contract.json");
  const { version, desktopPackage } = verifyVersions();
  verifyNodeOnly(contract, desktopPackage);
  verifyDocuments(contract, version);
  verifyLicensing();
  verifyArtifactVersioning(version);
  verifyLineEndingPolicy();
  verifyReleasePayload(argument("--release-dir"), argument("--artifact"), version, args.includes("--signed"));
  process.stdout.write("Release verification passed.\n");
} catch (error) {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
