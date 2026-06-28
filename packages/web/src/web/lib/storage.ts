import type { AppState, DaySettings, QuickAddStudy, WRVUEntry } from "../types";

const STORAGE_KEY = "wrvu_tracker_state";

const DEFAULT_QUICK_ADDS: QuickAddStudy[] = [
  { id: "ct-ap", name: "CT Abdomen/Pelvis w contrast", estimatedWrvu: 3.3 },
  { id: "ct-chest", name: "CT Chest w contrast", estimatedWrvu: 2.3 },
  { id: "cta-pe", name: "CTA Chest PE", estimatedWrvu: 3.5 },
  { id: "ct-head", name: "CT Head", estimatedWrvu: 1.9 },
  { id: "mri-brain", name: "MRI Brain", estimatedWrvu: 2.7 },
  { id: "mri-abd", name: "MRI Abdomen", estimatedWrvu: 3.8 },
  { id: "us-abd", name: "Ultrasound Abdomen", estimatedWrvu: 1.4 },
  { id: "mammo", name: "Mammogram/Tomo", estimatedWrvu: 1.5 },
  { id: "pet-ct", name: "PET/CT", estimatedWrvu: 3.0 },
  { id: "xray", name: "X-ray", estimatedWrvu: 0.5 },
];

const DEFAULT_SETTINGS: DaySettings = {
  dailyGoal: 90,
  startTime: "08:00",
  endTime: "17:00",
  lunchMinutes: 0,
};

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultState();
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      quickAdds: parsed.quickAdds ?? DEFAULT_QUICK_ADDS,
      entries: parsed.entries ?? [],
      theme: parsed.theme ?? "dark",
    };
  } catch {
    return getDefaultState();
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage full or unavailable
  }
}

export function getDefaultState(): AppState {
  return {
    settings: { ...DEFAULT_SETTINGS },
    quickAdds: DEFAULT_QUICK_ADDS.map((q) => ({ ...q })),
    entries: [],
    theme: "dark",
  };
}

export function exportCSV(entries: WRVUEntry[]): void {
  const header = "Timestamp,Exam Name,wRVU,Running Total\n";
  const rows = entries
    .map((e) => {
      const d = new Date(e.timestamp);
      const ts = `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
      const name = `"${e.examName.replace(/"/g, '""')}"`;
      return `${ts},${name},${e.wrvu.toFixed(2)},${e.runningTotal.toFixed(2)}`;
    })
    .join("\n");
  const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `wrvu_log_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
