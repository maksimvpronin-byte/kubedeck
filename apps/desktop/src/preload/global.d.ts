export {};

import type { AppFolder, DesktopInfo } from "../renderer/types";

declare global {
  interface Window {
    kubedeck: {
      getBackendAuth(): Promise<{ baseUrl: string; token: string }>;
      selectKubeconfig(): Promise<string | null>;
      openLogsFolder(): Promise<void>;
      openAppFolder(folder: AppFolder): Promise<void>;
      getDesktopInfo(): Promise<DesktopInfo>;
    };
  }
}
