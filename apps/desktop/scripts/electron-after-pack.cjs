const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  // Only macOS keeps the unpacked helper inside a .app bundle. Windows and Linux
  // builds have nothing to repair here, so they must not build a bogus path.
  if (context.electronPlatformName !== "darwin") return;

  const resourcesDir = context.appOutDir
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : "";
  if (!resourcesDir) return;

  for (const arch of ["darwin-arm64", "darwin-x64"]) {
    const helper = path.join(
      resourcesDir,
      "app.asar.unpacked",
      "node_modules",
      "node-pty",
      "prebuilds",
      arch,
      "spawn-helper",
    );
    if (fs.existsSync(helper)) {
      fs.chmodSync(helper, 0o755);
    }
  }
};
