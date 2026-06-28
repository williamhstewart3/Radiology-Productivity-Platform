import { createWorker, type Worker } from 'tesseract.js';

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
  confidence: number; // 0-1, overall OCR confidence
}

export interface OcrProvider {
  extractText(image: File | Blob): Promise<OcrResult>;
}

let tesseractWorker: Worker | null = null;

export class TesseractProvider implements OcrProvider {
  async extractText(image: File | Blob): Promise<OcrResult> {
    if (!tesseractWorker) {
      tesseractWorker = await createWorker('eng');
    }

    const { data } = await tesseractWorker.recognize(image);

    const lines = data.text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    return {
      rawText: data.text,
      lines,
      confidence: (data.confidence ?? 0) / 100,
    };
  }
}

export async function terminateOcrWorker() {
  if (tesseractWorker) {
    await tesseractWorker.terminate();
    tesseractWorker = null;
  }
}

/**
 * Placeholder for a future higher-accuracy provider. Not implemented in
 * Phase 1. Swapping this in means changing one line where OcrProvider is
 * instantiated -- no changes to matching, review UI, or DB writes.
 */
export class VisionApiProvider implements OcrProvider {
  async extractText(_image: File | Blob): Promise<OcrResult> {
    throw new Error('VisionApiProvider is not implemented in this build.');
  }
}

export function getDefaultOcrProvider(): OcrProvider {
  return new TesseractProvider();
}
