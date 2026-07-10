import { app, BrowserWindow, ipcMain, dialog, Notification, clipboard } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV !== "production";
const WEB_DEV_URL = process.env.WEBSITE_URL ?? "http://localhost:3000";
const WEB_DIST = path.join(__dirname, "../web-dist");

let win: BrowserWindow | null;

interface PowerScribeVisionRow {
  procedureName: string;
  examDateTime: string | null;
  modifiedDateTime: string | null;
  rawProcedureText: string;
  rawExamDateText: string;
  rawModifiedText: string;
  rowIndex: string | null;
  confidence: number;
  needsReview: boolean;
  reviewReason: string | null;
}

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

// Notifications
ipcMain.handle("notification:show", (_, title: string, body: string) => {
  new Notification({ title, body }).show();
});

function parseJsonObjectFromModelText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    if (fenced) return JSON.parse(fenced);
    const arrayStart = trimmed.indexOf("[");
    const arrayEnd = trimmed.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1));
    }
    const objectStart = trimmed.indexOf("{");
    const objectEnd = trimmed.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(trimmed.slice(objectStart, objectEnd + 1));
    }
    throw new Error("Vision model did not return valid JSON.");
  }
}

function normalizeVisionRows(value: unknown): PowerScribeVisionRow[] {
  const container = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const rawRows = Array.isArray(value)
    ? value
    : Array.isArray(container?.rows)
      ? container.rows
      : value && typeof value === "object"
        ? [value]
        : [];

  return rawRows
    .map((row) => {
      const record = row as Record<string, unknown>;
      const procedureName = typeof record.procedureName === "string"
        ? record.procedureName.trim()
        : typeof record.procedure === "string"
          ? record.procedure.trim()
          : "";
      const rawProcedureText = typeof record.rawProcedureText === "string" ? record.rawProcedureText : procedureName;
      const rawExamDateText = typeof record.rawExamDateText === "string"
        ? record.rawExamDateText
        : typeof record.examDateText === "string"
          ? record.examDateText
          : "";
      const rawModifiedText = typeof record.rawModifiedText === "string"
        ? record.rawModifiedText
        : typeof record.modifiedText === "string"
          ? record.modifiedText
          : "";
      const confidence = typeof record.confidence === "number" && Number.isFinite(record.confidence)
        ? Math.max(0, Math.min(1, record.confidence))
        : 0.75;
      return {
        procedureName: procedureName || "UNCLEAR POWERSCRIBE ROW",
        examDateTime: typeof record.examDateTime === "string" ? record.examDateTime : null,
        modifiedDateTime: typeof record.modifiedDateTime === "string" ? record.modifiedDateTime : null,
        rawProcedureText,
        rawExamDateText,
        rawModifiedText,
        rowIndex: typeof record.rowIndex === "string" || typeof record.rowIndex === "number" ? String(record.rowIndex) : null,
        confidence,
        needsReview: Boolean(record.needsReview) || !procedureName,
        reviewReason: typeof record.reviewReason === "string" ? record.reviewReason : null,
      };
    })
    .filter((row) => row.procedureName || row.rawExamDateText || row.rawModifiedText);
}

async function runOllamaPowerScribeVisionHelper(model = "llama3.2-vision"): Promise<PowerScribeVisionRow[]> {
  const image = clipboard.readImage();
  if (image.isEmpty()) {
    throw new Error("No clipboard screenshot is available for Vision extraction.");
  }

  const base64Image = image.toPNG().toString("base64");
  const prompt = [
    "You are extracting rows from a PowerScribe completed-studies worklist screenshot.",
    "Return only valid JSON. Do not include markdown.",
    "Extract visible rows from the table columns Procedure, Exam Date, and Modified.",
    "Do not assign CPT codes. Do not infer RVUs. Do not perform duplicate detection.",
    "Do not invent dates or times. If a value is not readable, use null or empty raw text.",
    "Use ISO minute datetimes like 2026-07-02T07:59 when date and time are visible.",
    "Return this exact shape:",
    "[{\"procedureName\":\"XR CHEST PORTABLE\",\"examDateTime\":\"2026-07-01T17:18\",\"modifiedDateTime\":\"2026-07-02T07:59\",\"rawProcedureText\":\"XR CHEST PORTABLE\",\"rawExamDateText\":\"7/1/2026 5:18 PM\",\"rawModifiedText\":\"7/2/2026 7:59 AM\",\"rowIndex\":\"1\",\"confidence\":0.95,\"needsReview\":false,\"reviewReason\":null}]",
  ].join("\n");

  const response = await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      images: [base64Image],
      stream: false,
      format: "json",
      options: {
        temperature: 0,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Ollama Vision request failed (${response.status}): ${body || response.statusText}`);
  }

  const payload = await response.json() as { response?: unknown };
  const modelText = typeof payload.response === "string" ? payload.response : "";
  return normalizeVisionRows(parseJsonObjectFromModelText(modelText));
}

// Local Ollama Vision extraction
ipcMain.handle("powerscribe:extract-clipboard-vision-rows", async (_, options?: { model?: string }) => {
  return await runOllamaPowerScribeVisionHelper(options?.model);
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

// --- App lifecycle ---

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
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

