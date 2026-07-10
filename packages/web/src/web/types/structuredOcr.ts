export interface PowerScribeVisionRow {
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

export interface BrowserVisionDiagnostics {
  engine: 'browser_vision';
  modelId: string;
  taskType: string;
  backend: 'webgpu' | 'wasm';
  dtype: string;
  approximateDownloadSize: string;
  expectedMemory: string;
  webGpuRequired: boolean;
  wasmFallbackAvailable: boolean;
  ocrUsed: false;
  modelLoadMs: number | null;
  inferenceMs: number | null;
  extractedRowCount: number;
  invalidRowCount: number;
  expectedVisibleRows: number | null;
  warning: string | null;
}

export interface BrowserVisionExtractionResult {
  rows: PowerScribeVisionRow[];
  diagnostics: BrowserVisionDiagnostics;
  rawModelOutput: string;
}
