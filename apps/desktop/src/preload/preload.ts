import { contextBridge, ipcRenderer } from "electron";
import type { AppFolder, DesktopInfo } from "../renderer/types";

contextBridge.exposeInMainWorld("kubedeck", {
  getBackendAuth: () => ipcRenderer.invoke("kubedeck:getBackendAuth") as Promise<{ baseUrl: string; token: string }>,
  getBackendUrl: () => ipcRenderer.invoke("kubedeck:getBackendUrl") as Promise<string>,
  selectKubeconfig: () => ipcRenderer.invoke("kubedeck:selectKubeconfig") as Promise<string | null>,
  openLogsFolder: () => ipcRenderer.invoke("kubedeck:openLogsFolder") as Promise<void>,
  openAppFolder: (folder: AppFolder) => ipcRenderer.invoke("kubedeck:openAppFolder", folder) as Promise<void>,
  getDesktopInfo: () => ipcRenderer.invoke("kubedeck:getDesktopInfo") as Promise<DesktopInfo>,
  openPodShell: (request: { clusterId: string; namespace: string; pod: string; container?: string }) =>
    ipcRenderer.invoke("kubedeck:openPodShell", request) as Promise<void>,
});
