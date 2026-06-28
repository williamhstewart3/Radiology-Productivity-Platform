import { app, BrowserWindow, ipcMain, dialog, Notification } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV !== "production";
const WEB_DEV_URL = process.env.WEBSITE_URL ?? "http://localhost:3000";
const WEB_DIST = path.join(__dirname, "../web-dist");

let win: BrowserWindow | null;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL(WEB_DEV_URL);
  } else {
    win.loadFile(path.join(WEB_DIST, "index.html"));
  }
}

// --- IPC Handlers ---

// Dialog
ipcMain.handle("dialog:open", async (_, opts) => {
  const result = await dialog.showOpenDialog(opts);
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("dialog:save", async (_, opts) => {
  const result = await dialog.showSaveDialog(opts);
  return result.canceled ? null : result.filePath;
});

// File system
ipcMain.handle("fs:read", async (_, filePath: string) => {
  return fs.readFile(filePath, "utf-8");
});

ipcMain.handle("fs:write", async (_, filePath: string, data: string) => {
  await fs.writeFile(filePath, data, "utf-8");
});

// Read binary file — returns base64 string (images for Tesseract OCR)
ipcMain.handle("fs:readBuffer", async (_, filePath: string) => {
  const buf = await fs.readFile(filePath);
  return buf.toString("base64");
});

// Move a file (processed / failed routing)
ipcMain.handle("fs:move", async (_, src: string, dest: string) => {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(src, dest);
});

// Delete a file
ipcMain.handle("fs:delete", async (_, filePath: string) => {
  await fs.unlink(filePath);
});

// Ensure directory exists (mkdir -p)
ipcMain.handle("fs:ensureDir", async (_, dirPath: string) => {
  await fs.mkdir(dirPath, { recursive: true });
});

// List image files in a directory (PNG + JPG only)
ipcMain.handle("fs:listImages", async (_, dirPath: string) => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && /\.(png|jpg|jpeg)$/i.test(e.name))
      .map((e) => path.join(dirPath, e.name));
  } catch {
    return [];
  }
});

// Get the default watch folder path
ipcMain.handle("fs:defaultWatchPath", () => {
  return path.join(app.getPath("documents"), "PowerScribe Screenshots");
});

// Notifications
ipcMain.handle("notification:show", (_, title: string, body: string) => {
  new Notification({ title, body }).show();
});

// Window controls
ipcMain.handle("window:minimize", () => win?.minimize());
ipcMain.handle("window:maximize", () => {
  if (win?.isMaximized()) {
    win.unmaximize();
  } else {
    win?.maximize();
  }
});
ipcMain.handle("window:close", () => win?.close());

// ─── Folder Watcher ──────────────────────────────────────────────────────────
//
// Uses Node.js fs.watch to monitor a folder for new PNG/JPG files.
// When a new image appears, emits "watcher:new-file" to the renderer with
// the full file path. The renderer runs Tesseract OCR on it, then calls
// fs:move to route it to /processed or /failed.
//
// Security: all file I/O is local. Nothing is transmitted externally.
// The renderer must call fs:stopWatcher before closing / changing folders.

let activeWatcher: fsSync.FSWatcher | null = null;
const WATCHER_DEBOUNCE_MS = 800; // avoid double-fire on file copy
const pendingFiles = new Map<string, ReturnType<typeof setTimeout>>();

ipcMain.handle("fs:watchFolder", async (_, folderPath: string) => {
  // Stop any existing watcher first
  if (activeWatcher) {
    activeWatcher.close();
    activeWatcher = null;
  }

  // Ensure the watched folder exists
  await fs.mkdir(folderPath, { recursive: true });

  activeWatcher = fsSync.watch(folderPath, { persistent: true }, (event, filename) => {
    if (!filename || !/\.(png|jpg|jpeg)$/i.test(filename)) return;
    const fullPath = path.join(folderPath, filename);

    // Debounce: wait until file has been stable for DEBOUNCE_MS ms
    const existing = pendingFiles.get(fullPath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      pendingFiles.delete(fullPath);
      // Verify file exists and is readable before notifying renderer
      try {
        await fs.access(fullPath, fsSync.constants.R_OK);
        win?.webContents.send("watcher:new-file", fullPath);
      } catch {
        // File gone before we could read it — ignore
      }
    }, WATCHER_DEBOUNCE_MS);

    pendingFiles.set(fullPath, timer);
  });

  activeWatcher.on("error", (err) => {
    win?.webContents.send("watcher:error", err.message);
  });

  return { ok: true };
});

ipcMain.handle("fs:stopWatcher", () => {
  if (activeWatcher) {
    activeWatcher.close();
    activeWatcher = null;
  }
  for (const t of pendingFiles.values()) clearTimeout(t);
  pendingFiles.clear();
  return { ok: true };
});

// --- App lifecycle ---

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (activeWatcher) activeWatcher.close();
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(createWindow);

