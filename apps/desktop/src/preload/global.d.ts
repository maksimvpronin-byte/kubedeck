export {};

import type { BootScreenApi } from "../renderer/bootProgress";
import type { AppFolder, DesktopInfo } from "../renderer/types";
import type { UpdateState } from "../shared/updateState";

declare global {
  interface Window {
    // Installed by public/boot-screen.js before the bundle runs; it stops
    // accepting stages once the screen has handed over to the application.
    __kubedeckBoot?: BootScreenApi;
    kubedeck: {
      getBackendAuth(): Promise<{ baseUrl: string; token: string }>;
      selectKubeconfig(): Promise<string | null>;
      openLogsFolder(): Promise<void>;
      openAppFolder(folder: AppFolder): Promise<void>;
      getDesktopInfo(): Promise<DesktopInfo>;
      getUpdateState(): Promise<UpdateState>;
      checkForUpdates(): Promise<UpdateState>;
      downloadUpdate(): Promise<UpdateState>;
      installUpdate(): Promise<UpdateState>;
      openReleases(): Promise<void>;
      onUpdateState(listener: (state: UpdateState) => void): () => void;
    };
  }
}
