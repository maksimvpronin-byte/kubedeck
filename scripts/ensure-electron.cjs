#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { downloadArtifact } = require("@electron/get");
const extract = require("extract-zip");

const root = path.resolve(__dirname, "..");
const electronRoot = path.join(root, "node_modules/electron");
const electronPackage = require(path.join(electronRoot, "package.json"));
const platform = process.env.npm_config_platform || process.platform;
const arch = process.env.npm_config_arch || process.arch;

function platformPath() {
  if (platform === "darwin" || platform === "mas") return "Electron.app/Contents/MacOS/Electron";
  if (platform === "win32") return "electron.exe";
  if (["linux", "freebsd", "openbsd"].includes(platform)) return "electron";
  throw new Error(`Electron builds are unavailable for platform ${platform}`);
}

async function main() {
  const executable = platformPath();
  const dist = path.join(electronRoot, "dist");
  const pathFile = path.join(electronRoot, "path.txt");
  const versionFile = path.join(dist, "version");
  const installed =
    fs.existsSync(path.join(dist, executable)) &&
    fs.existsSync(versionFile) &&
    fs.readFileSync(versionFile, "utf8").trim().replace(/^v/, "") === electronPackage.version &&
    fs.existsSync(pathFile) &&
    fs.readFileSync(pathFile, "utf8").trim() === executable;
  if (installed) {
    process.stdout.write(`Electron ${electronPackage.version} runtime is complete.\n`);
    return;
  }

  process.stdout.write(`Repairing Electron ${electronPackage.version} runtime for ${platform}-${arch}.\n`);
  const zip = await downloadArtifact({
    version: electronPackage.version,
    artifactName: "electron",
    platform,
    arch,
    cacheRoot: process.env.electron_config_cache,
    checksums: require(path.join(electronRoot, "checksums.json")),
  });
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  await extract(zip, { dir: dist });
  const extractedTypes = path.join(dist, "electron.d.ts");
  if (fs.existsSync(extractedTypes)) fs.renameSync(extractedTypes, path.join(electronRoot, "electron.d.ts"));
  fs.writeFileSync(pathFile, executable);
  if (platform !== "win32") fs.chmodSync(path.join(dist, executable), 0o755);
  if (!fs.existsSync(path.join(dist, executable))) throw new Error("Electron executable is missing after extraction");
  process.stdout.write(`Electron runtime repaired in ${path.relative(root, dist)}.\n`);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
