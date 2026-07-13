/** Type definition for the Electron preload API exposed via contextBridge */
import type { PowerScribeStructuredOcrRow } from '../types/structuredOcr';

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

  // Notifications
  showNotification: (title: string, body: string) => Promise<void>;

  // Windows PowerScribe OCR
  extractPowerScribeClipboardRows?: () => Promise<PowerScribeStructuredOcrRow[]>;

  // Window controls
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  /** Pins/unpins whichever window this call originates from (the main window or a Mini popup) always-on-top. Optional so older preload bundles degrade gracefully. */
  setAlwaysOnTop?: (pinned: boolean) => Promise<void>;

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
