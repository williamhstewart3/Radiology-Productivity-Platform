import { createWorker, PSM, type Worker } from 'tesseract.js';

/**
 * Local-only OCR engine abstraction. Capture images must never be sent to a
 * hosted OCR service. Tesseract.js is the engine of record; Chromium's native
 * TextDetector is preferred when the browser exposes it.
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
  positionedWords: OcrPositionedWord[];
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

export type OcrPositionedWord = OcrPositionedLine;

export interface OcrEngineParams {
  pageSegMode?: PSM;
  charWhitelist?: string;
  preserveInterwordSpaces?: boolean;
  dictionaryCorrection?: boolean;
  userDefinedDpi?: number;
}

export interface OcrEngine {
  readonly name: 'tesseract.js' | 'text-detector';
  extractText(image: File | Blob, params?: OcrEngineParams): Promise<OcrResult>;
}

let tesseractWorker: Worker | null = null;
let lastAppliedParams: Required<OcrEngineParams> | null = null;

export class TesseractProvider implements OcrEngine {
  readonly name = 'tesseract.js' as const;

  async extractText(image: File | Blob, params: OcrEngineParams = {}): Promise<OcrResult> {
    if (!tesseractWorker) {
      tesseractWorker = await createWorker('eng', undefined, {
        workerPath: '/ocr/tesseract/worker.min.js',
        corePath: '/ocr/tesseract/core',
        langPath: '/ocr/tesseract/lang',
      });
    }

    const nextParams: Required<OcrEngineParams> = {
      pageSegMode: params.pageSegMode ?? PSM.AUTO,
      charWhitelist: params.charWhitelist ?? '',
      preserveInterwordSpaces: params.preserveInterwordSpaces ?? false,
      dictionaryCorrection: params.dictionaryCorrection ?? true,
      userDefinedDpi: params.userDefinedDpi ?? 300,
    };
    if (
      lastAppliedParams?.pageSegMode !== nextParams.pageSegMode ||
      lastAppliedParams?.charWhitelist !== nextParams.charWhitelist ||
      lastAppliedParams?.preserveInterwordSpaces !== nextParams.preserveInterwordSpaces ||
      lastAppliedParams?.dictionaryCorrection !== nextParams.dictionaryCorrection ||
      lastAppliedParams?.userDefinedDpi !== nextParams.userDefinedDpi
    ) {
      await tesseractWorker.setParameters({
        tessedit_pageseg_mode: nextParams.pageSegMode,
        tessedit_char_whitelist: nextParams.charWhitelist,
        preserve_interword_spaces: nextParams.preserveInterwordSpaces ? '1' : '0',
        load_system_dawg: nextParams.dictionaryCorrection ? '1' : '0',
        load_freq_dawg: nextParams.dictionaryCorrection ? '1' : '0',
        user_defined_dpi: String(nextParams.userDefinedDpi),
      });
      lastAppliedParams = nextParams;
    }

    const { data } = await tesseractWorker.recognize(image, {}, { text: true, blocks: true });

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
    const positionedWords = (data.blocks ?? [])
      .flatMap((block) => block.paragraphs ?? [])
      .flatMap((paragraph) => paragraph.lines ?? [])
      .flatMap((line) => line.words ?? [])
      .map((word) => ({
        text: word.text.trim(),
        confidence: (word.confidence ?? 0) / 100,
        bbox: word.bbox ?? null,
      }))
      .filter((word) => word.text.length > 0);

    return {
      rawText: data.text,
      lines,
      positionedLines: positionedLines.length
        ? positionedLines
        : lines.map((line) => ({ text: line, confidence: (data.confidence ?? 0) / 100, bbox: null })),
      positionedWords,
      confidence: (data.confidence ?? 0) / 100,
    };
  }
}

export async function terminateOcrWorker() {
  if (tesseractWorker) {
    await tesseractWorker.terminate();
    tesseractWorker = null;
    lastAppliedParams = null;
  }
}

interface NativeDetectedText {
  rawValue: string;
  boundingBox: { x: number; y: number; width: number; height: number };
}

interface NativeTextDetector {
  detect(source: ImageBitmap): Promise<NativeDetectedText[]>;
}

type TextDetectorConstructor = new () => NativeTextDetector;

export function getTextDetectorConstructor(scope: typeof globalThis = globalThis): TextDetectorConstructor | null {
  const constructor = (scope as typeof globalThis & { TextDetector?: TextDetectorConstructor }).TextDetector;
  return typeof constructor === 'function' ? constructor : null;
}

export class TextDetectorEngine implements OcrEngine {
  readonly name = 'text-detector' as const;

  constructor(private readonly Detector: TextDetectorConstructor) {}

  async extractText(image: File | Blob): Promise<OcrResult> {
    const bitmap = await createImageBitmap(image);
    try {
      const detected = await new this.Detector().detect(bitmap);
      const positionedWords = detected
        .map((item) => ({
          text: item.rawValue.trim(),
          confidence: 1,
          bbox: {
            x0: item.boundingBox.x,
            y0: item.boundingBox.y,
            x1: item.boundingBox.x + item.boundingBox.width,
            y1: item.boundingBox.y + item.boundingBox.height,
          },
        }))
        .filter((item) => item.text.length > 0);
      const lines = positionedWords.map((item) => item.text);
      return {
        rawText: lines.join('\n'),
        lines,
        positionedLines: positionedWords,
        positionedWords,
        confidence: positionedWords.length > 0 ? 1 : 0,
      };
    } finally {
      bitmap.close();
    }
  }
}

export function getDefaultOcrEngine(scope: typeof globalThis = globalThis): OcrEngine {
  const TextDetector = getTextDetectorConstructor(scope);
  return TextDetector ? new TextDetectorEngine(TextDetector) : new TesseractProvider();
}
