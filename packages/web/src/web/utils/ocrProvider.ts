import { createWorker, PSM, type Worker } from 'tesseract.js';

/**
 * OCR provider abstraction. Phase 1 uses Tesseract.js (fully client-side,
 * no data leaves the device). A future provider (e.g. a hosted vision API)
 * can be swapped in by implementing this same interface -- nothing else in
 * the app needs to change.
 *
 * IMPORTANT: use a static `import { createWorker } from 'tesseract.js'` at
 * the top of this file, matching every official Tesseract.js v5 example.
 * An earlier version of this file used a dynamic `await import('tesseract.js')`
 * combined with `optimizeDeps: { exclude: ['tesseract.js'] }` in
 * vite.config.ts. Together those two choices meant Vite never ran its
 * normal CommonJS-to-ESM conversion on Tesseract.js's internals, so a bare
 * require() call inside the library reached the browser unconverted and
 * threw "require is not defined" the moment OCR ran. Both have been fixed:
 * the exclude was removed from vite.config.ts, and this file now uses a
 * static import, which is the documented, tested-working pattern.
 */
export interface OcrResult {
  rawText: string;
  lines: string[];
  positionedLines: OcrPositionedLine[];
  confidence: number; // 0-1, overall OCR confidence
}

export interface OcrPositionedLine {
  text: string;
  confidence: number;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null;
}

export interface OcrProviderParams {
  pageSegMode?: PSM;
  charWhitelist?: string;
}

export interface OcrProvider {
  extractText(image: File | Blob, params?: OcrProviderParams): Promise<OcrResult>;
}

/**
 * A single screenshot capture needs up to 3 concurrent OCR passes (the
 * procedure/exam-date/modified-date column crops). Tesseract.js workers run
 * off the main thread already, but ONE worker only runs one recognize() at
 * a time -- concurrent calls on a shared worker just queue. A small pool
 * (cap 3, matching the column count) lets those 3 passes actually run in
 * parallel instead of serially. Workers are created lazily and kept alive
 * for reuse across captures in the same session.
 */
const WORKER_POOL_SIZE = 3;

interface PooledWorker {
  worker: Worker;
  lastAppliedParams: Required<OcrProviderParams> | null;
  busy: boolean;
}

const pool: PooledWorker[] = [];
const waiters: Array<(entry: PooledWorker) => void> = [];

async function acquireWorker(): Promise<PooledWorker> {
  const idle = pool.find((entry) => !entry.busy);
  if (idle) {
    idle.busy = true;
    return idle;
  }
  if (pool.length < WORKER_POOL_SIZE) {
    const entry: PooledWorker = { worker: await createWorker('eng'), lastAppliedParams: null, busy: true };
    pool.push(entry);
    return entry;
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function releaseWorker(entry: PooledWorker): void {
  const next = waiters.shift();
  if (next) {
    next(entry);
    return;
  }
  entry.busy = false;
}

export class TesseractProvider implements OcrProvider {
  async extractText(image: File | Blob, params: OcrProviderParams = {}): Promise<OcrResult> {
    const entry = await acquireWorker();
    try {
      const nextParams: Required<OcrProviderParams> = {
        pageSegMode: params.pageSegMode ?? PSM.AUTO,
        charWhitelist: params.charWhitelist ?? '',
      };
      if (
        entry.lastAppliedParams?.pageSegMode !== nextParams.pageSegMode ||
        entry.lastAppliedParams?.charWhitelist !== nextParams.charWhitelist
      ) {
        await entry.worker.setParameters({
          tessedit_pageseg_mode: nextParams.pageSegMode,
          tessedit_char_whitelist: nextParams.charWhitelist,
        });
        entry.lastAppliedParams = nextParams;
      }

      const { data } = await entry.worker.recognize(image);

      const lines = data.text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const positionedLines = (data.blocks ?? [])
        .flatMap((block) => block.paragraphs ?? [])
        .flatMap((paragraph) => paragraph.lines ?? [])
        .map((line) => ({
          text: line.text.trim(),
          confidence: (line.confidence ?? 0) / 100,
          bbox: line.bbox ?? null,
        }))
        .filter((line) => line.text.length > 0);

      return {
        rawText: data.text,
        lines,
        positionedLines: positionedLines.length
          ? positionedLines
          : lines.map((line) => ({ text: line, confidence: (data.confidence ?? 0) / 100, bbox: null })),
        confidence: (data.confidence ?? 0) / 100,
      };
    } finally {
      releaseWorker(entry);
    }
  }
}

export async function terminateOcrWorker() {
  const entries = pool.splice(0, pool.length);
  waiters.length = 0;
  await Promise.all(entries.map((entry) => entry.worker.terminate()));
}

/**
 * Placeholder for a future higher-accuracy provider. Not implemented in
 * Phase 1. Swapping this in means changing one line where OcrProvider is
 * instantiated -- no changes to matching, review UI, or DB writes.
 */
export class VisionApiProvider implements OcrProvider {
  async extractText(_image: File | Blob, _params?: OcrProviderParams): Promise<OcrResult> {
    throw new Error('VisionApiProvider is not implemented in this build.');
  }
}

export function getDefaultOcrProvider(): OcrProvider {
  return new TesseractProvider();
}
