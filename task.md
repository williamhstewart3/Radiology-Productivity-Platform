# PowerScribe Screenshot Watcher — Build Plan

## Architecture

**Constraint**: No cloud, no external API, local-only. Tesseract.js already exists.
**Platform**: Desktop-first (Electron) but also works in browser via File System Access API drag-drop.

## Components to build

### 1. Electron main.ts additions
- `fs:watchFolder(folderPath)` — start fs.watch on a folder, emit `watcher:new-file` events to renderer
- `fs:stopWatcher()` — stop the watcher
- `fs:readFileBuffer(path)` — read binary (for images → blob for Tesseract)
- `fs:moveFile(src, dest)` — move processed/failed screenshots
- `fs:ensureDir(path)` — mkdir -p
- `fs:listDir(path)` — list PNG/JPG files in folder (for re-processing missed files)
- `fs:getDefaultWatchPath()` — returns `~/Documents/PowerScribe Screenshots`
- `watcher:new-file` event push to renderer

### 2. preload.ts additions
- Expose all above IPC calls + `onWatcherFile(cb)` event listener
- `stopWatcherFile()` cleanup

### 3. desktop.ts type additions
- All new IPC method types

### 4. New: `packages/web/src/web/utils/folderWatcher.ts`
- `useFolderWatcher(config)` React hook
  - Polls for new files (browser fallback) OR uses IPC (desktop)
  - Calls TesseractProvider.extractText()
  - Feeds result through existing OCRImportProvider → runImportPipeline()
  - Moves file to /processed or /failed via IPC
  - Emits status events for the UI

### 5. New: `packages/web/src/web/pages/WatcherPage.tsx`  
- PHI warning banner (prominent red, always visible)
- Folder path selector (uses dialog:open on desktop, explains limitation on web)
- Start/Stop watcher toggle
- Live activity feed: file processed, RVUs captured, errors
- Stats: files today, RVUs captured today, last file time
- "Auto-delete processed" toggle (stored in UserSettings)
- Link to Settings → Learned Mappings

### 6. Settings additions
- `watchFolderPath: string | null`
- `autoDeleteProcessed: boolean`
- DB migration v6 (add to userSettings via Dexie upgrade)

### 7. AutoHotkey script
- `PowerScribe_Watcher.ahk` — dropped in repo root
- Win+Shift+P hotkey: capture screen region → save timestamped PNG to watch folder
- No external calls, pure local file write

### 8. app.tsx
- Add 'watcher' tab to NAV_ITEMS + Tab union

## Files to create/modify
- `packages/desktop/electron/main.ts` — add watcher IPC
- `packages/desktop/electron/preload.ts` — expose watcher API
- `packages/web/src/web/lib/desktop.ts` — add watcher types
- `packages/web/src/web/utils/folderWatcher.ts` — new hook
- `packages/web/src/web/pages/WatcherPage.tsx` — new page
- `packages/web/src/web/pages/Settings.tsx` — watcher settings fields
- `packages/web/src/web/db/database.ts` — v6 migration
- `packages/web/src/web/types/index.ts` — add watchFolderPath + autoDeleteProcessed to UserSettings
- `packages/web/src/web/app.tsx` — add watcher tab
- `PowerScribe_Watcher.ahk` — new file in repo root

## Status: IN PROGRESS
