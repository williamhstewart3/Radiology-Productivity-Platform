import { ipcRenderer, contextBridge } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,

  // Dialog
  showOpenDialog: (opts: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke("dialog:open", opts),
  showSaveDialog: (opts: Electron.SaveDialogOptions) =>
    ipcRenderer.invoke("dialog:save", opts),

  // File system
  readFile: (path: string) => ipcRenderer.invoke("fs:read", path),
  writeFile: (path: string, data: string) =>
    ipcRenderer.invoke("fs:write", path, data),

  // Notifications
  showNotification: (title: string, body: string) =>
    ipcRenderer.invoke("notification:show", title, body),

  // Window controls
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),

  // Extended file system (watcher pipeline)
  readFileBuffer: (path: string) => ipcRenderer.invoke("fs:readBuffer", path),
  moveFile: (src: string, dest: string) => ipcRenderer.invoke("fs:move", src, dest),
  deleteFile: (path: string) => ipcRenderer.invoke("fs:delete", path),
  ensureDir: (path: string) => ipcRenderer.invoke("fs:ensureDir", path),
  listImages: (dir: string) => ipcRenderer.invoke("fs:listImages", dir),
  defaultWatchPath: () => ipcRenderer.invoke("fs:defaultWatchPath"),
  watchFolder: (path: string) => ipcRenderer.invoke("fs:watchFolder", path),
  stopWatcher: () => ipcRenderer.invoke("fs:stopWatcher"),

  onWatcherFile: (cb: (path: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, p: string) => cb(p);
    ipcRenderer.on("watcher:new-file", listener);
    return () => ipcRenderer.removeListener("watcher:new-file", listener);
  },
  onWatcherError: (cb: (err: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, e: string) => cb(e);
    ipcRenderer.on("watcher:error", listener);
    return () => ipcRenderer.removeListener("watcher:error", listener);
  },

  // Events from main → renderer
  onDeepLink: (cb: (url: string) => void) => {
    ipcRenderer.on("deep-link", (_, url) => cb(url));
    return () => ipcRenderer.removeAllListeners("deep-link");
  },
});
