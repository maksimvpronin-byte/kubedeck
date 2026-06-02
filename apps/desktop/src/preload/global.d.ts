export {};

import type { AppFolder, DesktopInfo } from "../renderer/types";

declare global {
  interface Window {
    kubedeck: {
      getBackendAuth(): Promise<{ baseUrl: string; token: string }>;
      getBackendUrl(): Promise<string>;
      selectKubeconfig(): Promise<string | null>;
      openLogsFolder(): Promise<void>;
      openAppFolder(folder: AppFolder): Promise<void>;
      getDesktopInfo(): Promise<DesktopInfo>;
      openPodShell(request: { clusterId: string; namespace: string; pod: string; container?: string }): Promise<void>;
    };
  }
}
