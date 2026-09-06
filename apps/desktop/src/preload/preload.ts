import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppFolder, DesktopInfo } from "../renderer/types";
import type { UpdateState } from "../shared/updateState";

contextBridge.exposeInMainWorld("kubedeck", {
  getBackendAuth: () => ipcRenderer.invoke("kubedeck:getBackendAuth") as Promise<{ baseUrl: string; token: string }>,
  selectKubeconfig: () => ipcRenderer.invoke("kubedeck:selectKubeconfig") as Promise<string | null>,
  openLogsFolder: () => ipcRenderer.invoke("kubedeck:openLogsFolder") as Promise<void>,
  openAppFolder: (folder: AppFolder) => ipcRenderer.invoke("kubedeck:openAppFolder", folder) as Promise<void>,
  getDesktopInfo: () => ipcRenderer.invoke("kubedeck:getDesktopInfo") as Promise<DesktopInfo>,
  getUpdateState: () => ipcRenderer.invoke("kubedeck:getUpdateState") as Promise<UpdateState>,
  checkForUpdates: () => ipcRenderer.invoke("kubedeck:checkForUpdates") as Promise<UpdateState>,
  downloadUpdate: () => ipcRenderer.invoke("kubedeck:downloadUpdate") as Promise<UpdateState>,
  installUpdate: () => ipcRenderer.invoke("kubedeck:installUpdate") as Promise<UpdateState>,
  openReleases: () => ipcRenderer.invoke("kubedeck:openReleases") as Promise<void>,
  // Progress arrives on its own rather than being polled, so a download shows a
  // moving bar. The disposer matters: About is mounted and unmounted every time
  // the section is opened, and without it each visit would leave a listener
  // behind and Electron would warn about a leak after ten of them.
  onUpdateState: (listener: (state: UpdateState) => void) => {
    const handler = (_event: IpcRendererEvent, state: UpdateState) => listener(state);
    ipcRenderer.on("kubedeck:updateState", handler);
    return () => {
      ipcRenderer.removeListener("kubedeck:updateState", handler);
    };
  },
});
