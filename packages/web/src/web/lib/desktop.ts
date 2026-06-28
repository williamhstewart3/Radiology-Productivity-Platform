/** Type definition for the Electron preload API exposed via contextBridge */
export interface ElectronAPI {
  platform: string;

  // Dialog
  showOpenDialog: (opts: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
    properties?: string[];
  }) => Promise<string[]>;
  showSaveDialog: (opts: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<string | null>;

  // File system
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;

  // Extended file system (watcher pipeline)
  readFileBuffer: (path: string) => Promise<string>; // returns base64
  moveFile: (src: string, dest: string) => Promise<{ ok: boolean }>;
  deleteFile: (path: string) => Promise<{ ok: boolean }>;
  ensureDir: (path: string) => Promise<{ ok: boolean }>;
  listImages: (dir: string) => Promise<string[]>;
  defaultWatchPath: () => Promise<string>;
  watchFolder: (path: string) => Promise<{ ok: boolean }>;
  stopWatcher: () => Promise<{ ok: boolean }>;
  onWatcherFile: (cb: (path: string) => void) => () => void;
  onWatcherError: (cb: (err: string) => void) => () => void;

  // Notifications
  showNotification: (title: string, body: string) => Promise<void>;

  // Window controls
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;

  // Events
  onDeepLink: (cb: (url: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export function getDesktopAPI(): ElectronAPI | null {
  return window.electronAPI ?? null;
}

export function isDesktop(): boolean {
  return getDesktopAPI() !== null;
}
