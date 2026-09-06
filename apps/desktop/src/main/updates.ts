import { spawnSync } from "node:child_process";
import { app, shell } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateState } from "../shared/updateState";

// Where a copy that cannot replace itself is sent instead. It has to agree with
// `publish` in electron-builder.yml - that block is what writes the metadata
// this module reads - and tests/auto-update.contract.test.cjs holds the two
// together.
export const RELEASES_URL = "https://github.com/maksimvpronin-byte/kubedeck/releases";

export interface UpdateController {
  state(): UpdateState;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  install(): Promise<UpdateState>;
  openReleases(): Promise<void>;
}

export interface UpdateControllerOptions {
  log: (message: string) => void;
  /** Called whenever the state changes, so the window can follow along. */
  publish: (state: UpdateState) => void;
  /** Shuts the gateway down before the installer starts replacing files. */
  prepareForRestart: () => Promise<void>;
}

// The same question verify-release.cjs asks of a finished build, asked at
// runtime: is this bundle signed by a real identity, or only ad-hoc?
//
// Squirrel.Mac refuses to replace an application whose signature it cannot
// match, so an unsigned KubeDeck that downloads an update would spend the
// bandwidth and then fail at the last step. Asking codesign is a spawn, but
// only on macOS, only when packaged, and only once - and it means the answer
// corrects itself the day a Developer ID certificate is configured, rather than
// staying wrong until someone remembers this line.
function macBundleIsSigned(log: (message: string) => void): boolean {
  const bundle = process.execPath.replace(/\/Contents\/MacOS\/[^/]+$/, "");
  const result = spawnSync("codesign", ["-dv", "--verbose=4", bundle], { encoding: "utf8" });
  if (result.status !== 0) {
    log(`update: codesign could not inspect ${bundle}`);
    return false;
  }
  const info = `${result.stdout}${result.stderr}`;
  return /Authority=Developer ID Application/.test(info) && !/adhoc/i.test(info);
}

function describeInstallability(log: (message: string) => void): { canInstall: boolean; message: string } {
  if (!app.isPackaged) return { canInstall: false, message: "about.update.reason.development" };
  // The portable build unpacks itself into a temporary directory on every run.
  // There is no installation for an update to replace, and electron-builder
  // sets this variable for exactly that build.
  if (process.env.PORTABLE_EXECUTABLE_DIR) return { canInstall: false, message: "about.update.reason.portable" };
  if (process.platform === "darwin" && !macBundleIsSigned(log)) {
    return { canInstall: false, message: "about.update.reason.unsigned" };
  }
  return { canInstall: true, message: "" };
}

export function createUpdateController({ log, publish, prepareForRestart }: UpdateControllerOptions): UpdateController {
  const installability = describeInstallability(log);
  let state: UpdateState = {
    status: "idle",
    currentVersion: app.getVersion(),
    availableVersion: "",
    percent: 0,
    // Carries the reason from the start, so About can say why installing in
    // place is not on offer before anyone has pressed anything.
    message: installability.message,
    canInstall: installability.canInstall,
    releasesUrl: RELEASES_URL,
  };

  function set(patch: Partial<UpdateState>) {
    state = { ...state, ...patch };
    publish(state);
  }

  // Nothing is fetched until someone asks. A release is a couple of hundred
  // megabytes, and downloading that unasked is rude on a metered connection and
  // pure waste on a build that cannot install it anyway.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (message?: unknown) => log(`update: ${String(message)}`),
    warn: (message?: unknown) => log(`update warn: ${String(message)}`),
    error: (message?: unknown) => log(`update error: ${String(message)}`),
    debug: () => undefined,
  };

  // `message` falls back to the standing reason rather than to nothing: a
  // portable build that has just failed a check still cannot install in place,
  // and About has to keep saying so once the failure is cleared.
  autoUpdater.on("checking-for-update", () => set({ status: "checking", message: installability.message }));
  autoUpdater.on("update-available", (info) => set({ status: "available", availableVersion: info.version, percent: 0, message: installability.message }));
  autoUpdater.on("update-not-available", () => set({ status: "current", availableVersion: "", percent: 0, message: installability.message }));
  autoUpdater.on("download-progress", (progress) => set({ status: "downloading", percent: Math.max(0, Math.min(100, Math.round(progress.percent))) }));
  autoUpdater.on("update-downloaded", (info) => set({ status: "downloaded", availableVersion: info.version, percent: 100, message: installability.message }));
  autoUpdater.on("error", (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    log(`update failed: ${message}`);
    set({ status: "error", message });
  });

  async function check() {
    if (!app.isPackaged) {
      // checkForUpdates in a development run fails on a missing
      // dev-app-update.yml, which describes the tooling rather than anything
      // the person at the keyboard did.
      set({ status: "unsupported", message: installability.message });
      return state;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ status: "error", message });
    }
    return state;
  }

  async function download() {
    // An update that cannot be installed is not worth downloading; the release
    // page is what those builds are offered.
    if (!state.canInstall || state.status !== "available") return state;
    set({ status: "downloading", percent: 0 });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ status: "error", message });
    }
    return state;
  }

  async function install() {
    if (state.status !== "downloaded") return state;
    // The gateway holds ports, a kubectl child process and open watches. On
    // Windows it also holds files the installer is about to replace, so it goes
    // down before the installer starts rather than racing it.
    await prepareForRestart();
    autoUpdater.quitAndInstall();
    return state;
  }

  async function openReleases() {
    await shell.openExternal(RELEASES_URL);
  }

  return { state: () => state, check, download, install, openReleases };
}
