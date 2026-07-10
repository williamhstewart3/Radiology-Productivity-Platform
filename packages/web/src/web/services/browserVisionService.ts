import type { BrowserVisionDiagnostics, BrowserVisionExtractionResult, PowerScribeVisionRow } from '../types/structuredOcr';

export type BrowserVisionStatus =
  | 'uninitialized'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'loading'
  | 'ready'
  | 'webgpu_unavailable'
  | 'model_failed'
  | 'extraction_failed';

export interface BrowserVisionModelInfo {
  modelId: string;
  taskType: string;
  dtype: string;
  approximateDownloadSize: string;
  expectedMemory: string;
  webGpuMandatory: boolean;
  wasmSupportedExplicitly: boolean;
  notes: string;
}

export interface BrowserVisionSupport {
  available: boolean;
  status: BrowserVisionStatus;
  backend: 'webgpu' | 'wasm' | null;
  reason: string | null;
  supportsFp16: boolean;
}

interface BrowserVisionState {
  status: BrowserVisionStatus;
  model: unknown | null;
  processor: unknown | null;
  tokenizer: unknown | null;
  backend: 'webgpu' | 'wasm' | null;
  modelLoadMs: number | null;
  lastError: string | null;
  progress: number | null;
  supportsFp16: boolean;
  dtype: string | Record<string, string> | null;
}

type ProgressCallback = (progress: { status: BrowserVisionStatus; progress: number | null; message: string }) => void;

type FlorenceModule = {
  Florence2ForConditionalGeneration: {
    from_pretrained: (modelId: string, options?: Record<string, unknown>) => Promise<unknown>;
  };
  AutoProcessor: {
    from_pretrained: (modelId: string, options?: Record<string, unknown>) => Promise<unknown>;
  };
  AutoTokenizer: {
    from_pretrained: (modelId: string, options?: Record<string, unknown>) => Promise<unknown>;
  };
  RawImage: {
    fromBlob?: (blob: Blob) => Promise<unknown>;
    read?: (input: Blob | string | URL) => Promise<unknown>;
  };
};

const MODEL_INFO: BrowserVisionModelInfo = {
  modelId: 'onnx-community/Florence-2-base-ft',
  taskType: 'image-text-to-text',
  dtype: 'mixed: fp16 vision/embed + q4 encoder/decoder when supported',
  approximateDownloadSize: '~900 MB to 1.5 GB depending on cached ONNX shards and dtype',
  expectedMemory: 'Practical WebGPU testing target: 4 GB+ available browser/GPU memory',
  webGpuMandatory: true,
  wasmSupportedExplicitly: true,
  notes: 'Transformers.js-compatible ONNX Florence-2 model. This is an experimental benchmark for small-table screenshot extraction, not a validated production parser.',
};

const state: BrowserVisionState = {
  status: 'uninitialized',
  model: null,
  processor: null,
  tokenizer: null,
  backend: null,
  modelLoadMs: null,
  lastError: null,
  progress: null,
  supportsFp16: false,
  dtype: null,
};

export function getBrowserVisionModelInfo(): BrowserVisionModelInfo {
  return MODEL_INFO;
}

export function getBrowserVisionStatus(): BrowserVisionState {
  return { ...state };
}

export async function detectBrowserVisionSupport(options: { allowWasmFallback?: boolean } = {}): Promise<BrowserVisionSupport> {
  state.status = 'checking';
  if (typeof navigator === 'undefined') {
    state.status = 'webgpu_unavailable';
    return { available: false, status: state.status, backend: null, reason: 'Browser APIs are not available in this environment.', supportsFp16: false };
  }

  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter() as { features?: { has?: (feature: string) => boolean } } | null;
      if (adapter) {
        const supportsFp16 = Boolean(adapter.features?.has?.('shader-f16'));
        state.status = 'available';
        state.backend = 'webgpu';
        state.supportsFp16 = supportsFp16;
        return { available: true, status: state.status, backend: 'webgpu', reason: null, supportsFp16 };
      }
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  if (options.allowWasmFallback) {
    state.status = 'available';
    state.backend = 'wasm';
    state.supportsFp16 = false;
    return { available: true, status: state.status, backend: 'wasm', reason: 'WebGPU unavailable; explicit WASM fallback selected.', supportsFp16: false };
  }

  state.status = 'webgpu_unavailable';
  state.backend = null;
  state.supportsFp16 = false;
  return { available: false, status: state.status, backend: null, reason: 'WebGPU is unavailable. Browser Vision will not silently fall back to WASM.', supportsFp16: false };
}

function dtypeForSupport(support: BrowserVisionSupport): string | Record<string, string> {
  if (support.backend === 'wasm') return 'q4';
  if (support.supportsFp16) {
    return {
      embed_tokens: 'fp16',
      vision_encoder: 'fp16',
      encoder_model: 'q4',
      decoder_model_merged: 'q4',
    };
  }
  return {
    embed_tokens: 'fp32',
    vision_encoder: 'fp32',
    encoder_model: 'q4',
    decoder_model_merged: 'q4',
  };
}

function dtypeLabel(dtype: string | Record<string, string> | null): string {
  if (!dtype) return MODEL_INFO.dtype;
  if (typeof dtype === 'string') return dtype;
  return Object.entries(dtype).map(([key, value]) => `${key}:${value}`).join(', ');
}

export async function downloadAndInitializeVisionModel(options: {
  allowWasmFallback?: boolean;
  onProgress?: ProgressCallback;
} = {}): Promise<BrowserVisionSupport> {
  if (state.model && state.processor && state.tokenizer && state.backend) {
    state.status = 'ready';
    return { available: true, status: state.status, backend: state.backend, reason: null, supportsFp16: state.supportsFp16 };
  }

  const support = await detectBrowserVisionSupport({ allowWasmFallback: options.allowWasmFallback });
  if (!support.available || !support.backend) return support;

  state.status = 'loading';
  state.progress = null;
  options.onProgress?.({ status: 'loading', progress: null, message: `Loading ${MODEL_INFO.modelId}` });
  const start = performance.now();

  try {
    const transformers = await import('@huggingface/transformers') as unknown as FlorenceModule;
    const progress_callback = (event: unknown) => {
      const item = event as { status?: string; progress?: number; file?: string };
      const progress = typeof item.progress === 'number' ? item.progress / 100 : null;
      state.status = item.status === 'progress' || item.status === 'download' ? 'downloading' : 'loading';
      state.progress = progress;
      options.onProgress?.({
        status: state.status,
        progress,
        message: item.file ? `Loading ${item.file}` : `Loading ${MODEL_INFO.modelId}`,
      });
    };
    const dtype = dtypeForSupport(support);
    state.dtype = dtype;
    const commonOptions = {
      device: support.backend,
      dtype,
      progress_callback,
    };

    const [model, processor, tokenizer] = await Promise.all([
      transformers.Florence2ForConditionalGeneration.from_pretrained(MODEL_INFO.modelId, commonOptions),
      transformers.AutoProcessor.from_pretrained(MODEL_INFO.modelId, { progress_callback }),
      transformers.AutoTokenizer.from_pretrained(MODEL_INFO.modelId, { progress_callback }),
    ]);

    state.model = model;
    state.processor = processor;
    state.tokenizer = tokenizer;
    state.backend = support.backend;
    state.supportsFp16 = support.supportsFp16;
    state.modelLoadMs = Math.round(performance.now() - start);
    state.status = 'ready';
    state.progress = 1;
    state.lastError = null;
    options.onProgress?.({ status: 'ready', progress: 1, message: 'Browser Vision ready' });
    return { available: true, status: 'ready', backend: support.backend, reason: null, supportsFp16: support.supportsFp16 };
  } catch (error) {
    state.status = 'model_failed';
    state.lastError = error instanceof Error ? error.message : String(error);
    options.onProgress?.({ status: 'model_failed', progress: null, message: state.lastError });
    return { available: false, status: 'model_failed', backend: support.backend, reason: state.lastError, supportsFp16: support.supportsFp16 };
  }
}

export async function disposeVisionModel(): Promise<void> {
  const disposableModel = state.model as { dispose?: () => Promise<void> | void } | null;
  if (disposableModel?.dispose) await disposableModel.dispose();
  state.model = null;
  state.processor = null;
  state.tokenizer = null;
  state.status = 'uninitialized';
  state.backend = null;
  state.modelLoadMs = null;
  state.progress = null;
  state.supportsFp16 = false;
  state.dtype = null;
}

export function extractJsonFromModelText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const objectStart = candidate.indexOf('{');
    const objectEnd = candidate.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(candidate.slice(objectStart, objectEnd + 1));
    }
    const arrayStart = candidate.indexOf('[');
    const arrayEnd = candidate.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return JSON.parse(candidate.slice(arrayStart, arrayEnd + 1));
    }
    throw new Error('Browser Vision did not return parseable JSON.');
  }
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.6;
  return Math.max(0, Math.min(1, value));
}

export function normalizeBrowserVisionRows(output: unknown): { rows: PowerScribeVisionRow[]; invalidRowCount: number } {
  const rowsValue =
    Array.isArray(output) ? output :
    output && typeof output === 'object' && Array.isArray((output as { rows?: unknown }).rows) ? (output as { rows: unknown[] }).rows :
    null;
  if (!rowsValue) throw new Error('Browser Vision JSON must contain a rows array.');

  let invalidRowCount = 0;
  const rows: PowerScribeVisionRow[] = [];
  for (const rawRow of rowsValue) {
    if (!rawRow || typeof rawRow !== 'object') {
      invalidRowCount++;
      continue;
    }
    const record = rawRow as Record<string, unknown>;
    const procedure = asText(record.procedure) ?? asText(record.procedureName) ?? asText(record.rawProcedureText);
    const examDate = asText(record.examDateTime) ?? asText(record.examDate) ?? null;
    const modified = asText(record.modifiedDateTime) ?? asText(record.modified) ?? asText(record.readDateTime) ?? null;
    if (!procedure) {
      invalidRowCount++;
      continue;
    }
    const reviewReasons = [
      !examDate ? 'Browser Vision did not extract Exam Date/Time.' : null,
      !modified ? 'Browser Vision did not extract Modified/Read Date/Time.' : null,
      asConfidence(record.confidence) < 0.75 ? 'Low Browser Vision confidence.' : null,
    ].filter(Boolean) as string[];
    rows.push({
      procedureName: procedure,
      examDateTime: examDate,
      modifiedDateTime: modified,
      rawProcedureText: procedure,
      rawExamDateText: examDate ?? '',
      rawModifiedText: modified ?? '',
      rowIndex: asText(record.rowNumber) ?? asText(record.rowIndex),
      confidence: asConfidence(record.confidence),
      needsReview: reviewReasons.length > 0,
      reviewReason: reviewReasons.join(' ') || null,
    });
  }
  return { rows, invalidRowCount };
}

async function cropWorklistTable(imageBlob: Blob): Promise<{ blob: Blob; expectedVisibleRows: number | null }> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return { blob: imageBlob, expectedVisibleRows: null };
  }
  const bitmap = await createImageBitmap(imageBlob);
  const crop = {
    x: Math.round(bitmap.width * 0.27),
    y: Math.round(bitmap.height * 0.08),
    width: Math.round(bitmap.width * 0.72),
    height: Math.round(bitmap.height * 0.87),
  };
  const canvas = document.createElement('canvas');
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { blob: imageBlob, expectedVisibleRows: null };
  ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const expectedVisibleRows = Math.max(1, Math.round((crop.height - 34) / 18));
  const croppedBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Browser Vision crop could not be encoded.')), 'image/png');
  });
  return { blob: croppedBlob, expectedVisibleRows };
}

async function blobToRawImage(blob: Blob): Promise<unknown> {
  const transformers = await import('@huggingface/transformers') as unknown as FlorenceModule;
  if (transformers.RawImage.fromBlob) return transformers.RawImage.fromBlob(blob);
  if (transformers.RawImage.read) return transformers.RawImage.read(blob);
  return blob;
}

function browserVisionPrompt(): string {
  return [
    'Read only the PowerScribe completed-studies table in this screenshot.',
    'Return JSON only. Use this shape: {"rows":[{"rowNumber":1,"procedure":"XR CHEST PORTABLE","examDateTime":"7/1/2026 5:18 PM","modifiedDateTime":"7/2/2026 7:59 AM","confidence":0.98}]}',
    'Include every visible study row exactly once.',
    'Preserve Procedure, Exam Date with time, and Modified Date with time.',
    'Do not assign CPT codes, RVUs, duplicate status, or inferred invisible rows.',
    'If uncertain, keep the row and lower confidence.',
  ].join('\n');
}

export async function extractPowerScribeRows(imageBlob: Blob, options: {
  allowWasmFallback?: boolean;
  onProgress?: ProgressCallback;
} = {}): Promise<BrowserVisionExtractionResult> {
  const support = await downloadAndInitializeVisionModel(options);
  if (!support.available || !support.backend || !state.model || !state.processor || !state.tokenizer) {
    state.status = support.status === 'webgpu_unavailable' ? 'webgpu_unavailable' : 'model_failed';
    throw new Error(support.reason ?? 'Browser Vision model is not ready.');
  }

  const { blob, expectedVisibleRows } = await cropWorklistTable(imageBlob);
  const image = await blobToRawImage(blob);
  const processor = state.processor as {
    construct_prompts?: (text: string | string[]) => string[];
    batch_decode?: (ids: unknown, options?: Record<string, unknown>) => string[];
    post_process_generation?: (text: string, task: string, imageSize: [number, number]) => Record<string, unknown>;
  } & ((image: unknown, prompts?: unknown) => Promise<Record<string, unknown>>);
  const tokenizer = state.tokenizer as {
    batch_decode?: (ids: unknown, options?: Record<string, unknown>) => string[];
  };
  const model = state.model as {
    generate: (inputs: Record<string, unknown>) => Promise<unknown>;
  };

  const prompt = browserVisionPrompt();
  const prompts = processor.construct_prompts ? processor.construct_prompts(prompt) : [prompt];
  const inputs = await processor(image, prompts);
  const start = performance.now();
  try {
    const generatedIds = await model.generate({
      ...inputs,
      max_new_tokens: 2048,
      do_sample: false,
    });
    const decoder = processor.batch_decode ?? tokenizer.batch_decode;
    if (!decoder) throw new Error('Browser Vision tokenizer cannot decode model output.');
    const rawModelOutput = decoder.call(processor.batch_decode ? processor : tokenizer, generatedIds, { skip_special_tokens: true })[0] ?? '';
    const inferenceMs = Math.round(performance.now() - start);
    const parsed = extractJsonFromModelText(rawModelOutput);
    const { rows, invalidRowCount } = normalizeBrowserVisionRows(parsed);
    const warning =
      expectedVisibleRows != null && rows.length < Math.max(1, Math.floor(expectedVisibleRows * 0.85))
        ? 'Possible missed studies: expected worklist appears to contain more rows than were extracted.'
        : null;
    const diagnostics: BrowserVisionDiagnostics = {
      engine: 'browser_vision',
      modelId: MODEL_INFO.modelId,
      taskType: MODEL_INFO.taskType,
      backend: support.backend,
      dtype: dtypeLabel(state.dtype),
      approximateDownloadSize: MODEL_INFO.approximateDownloadSize,
      expectedMemory: MODEL_INFO.expectedMemory,
      webGpuRequired: true,
      wasmFallbackAvailable: Boolean(options.allowWasmFallback),
      ocrUsed: false,
      modelLoadMs: state.modelLoadMs,
      inferenceMs,
      extractedRowCount: rows.length,
      invalidRowCount,
      expectedVisibleRows,
      warning,
    };
    state.status = 'ready';
    return { rows, diagnostics, rawModelOutput };
  } catch (error) {
    state.status = 'extraction_failed';
    state.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}
