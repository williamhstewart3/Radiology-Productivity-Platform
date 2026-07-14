import { detectPowerScribeDatetimeLayout, detectPowerScribeHeaderLayout, type PowerScribeOcrWord } from './powerScribeHeaderAnchors';

export interface RelativeCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_POWERSCRIBE_STUDY_LIST_CROP: RelativeCropRect = {
  x: 0.2,
  y: 0.22,
  width: 0.76,
  height: 0.72,
};

export interface DetectedCrop {
  rect: RelativeCropRect;
  confidence: number;
  method: 'headerAnchors' | 'datetimeColumns' | 'pixelValley' | 'savedCrop' | 'manual' | 'fallback';
}

export interface CroppedImageResult {
  blob: Blob;
  crop: DetectedCrop;
}

export type PowerScribeColumnName = 'procedure' | 'examDate' | 'modifiedDate';

export interface PowerScribeColumnCrop {
  name: PowerScribeColumnName;
  blob: Blob;
  rect: RelativeCropRect;
}

export interface PowerScribeColumnPreprocessResult {
  tableCrop: DetectedCrop;
  threeColumnCrop: DetectedCrop;
  columns: PowerScribeColumnCrop[];
  accounting: PowerScribeCropAccounting;
}

export interface PowerScribeCropAccounting {
  engine: 'tesseract.js' | 'text-detector';
  cropMethod: DetectedCrop['method'];
  imageWidth: number;
  imageHeight: number;
  modifiedAnchorCount: number;
  bandPitch: number | null;
  preprocessScale: number;
  headerValleyDrift: number | null;
  inputRowCount: number;
  outputRowCount: number;
}

export interface PowerScribePreprocessOptions {
  manualCrop?: RelativeCropRect | null;
  savedCrop?: RelativeCropRect | null;
  headerWords?: PowerScribeOcrWord[];
}

export class PowerScribeTableNotFoundError extends Error {
  constructor() {
    super("Couldn't find the PowerScribe table. Capture the full PowerScribe worklist and try again.");
    this.name = 'PowerScribeTableNotFoundError';
  }
}

export function selectPowerScribeCropTier(input: {
  manual: boolean;
  headerAnchors: boolean;
  datetimeColumns: boolean;
  pixelValley: boolean;
  savedCrop: boolean;
  hasPowerScribeSignal: boolean;
}): DetectedCrop['method'] | null {
  if (input.manual) return 'manual';
  if (input.headerAnchors) return 'headerAnchors';
  if (input.datetimeColumns) return 'datetimeColumns';
  if (input.hasPowerScribeSignal && input.pixelValley) return 'pixelValley';
  if (input.hasPowerScribeSignal && input.savedCrop) return 'savedCrop';
  return null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeCrop(rect: RelativeCropRect): RelativeCropRect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  const width = Math.max(0.05, Math.min(1 - x, clamp01(rect.width)));
  const height = Math.max(0.05, Math.min(1 - y, clamp01(rect.height)));
  return { x, y, width, height };
}

function boundToStudyListArea(rect: RelativeCropRect): RelativeCropRect {
  const bounded = normalizeCrop(rect);
  const minX = 0.18;
  const minY = 0.2;
  const maxRight = 0.98;
  const maxBottom = 0.965;
  const x = Math.max(minX, bounded.x);
  const y = Math.max(minY, bounded.y);
  const right = Math.min(maxRight, Math.max(x + 0.45, bounded.x + bounded.width));
  const bottom = Math.min(maxBottom, Math.max(y + 0.24, bounded.y + bounded.height));
  return normalizeCrop({
    x,
    y,
    width: right - x,
    height: bottom - y,
  });
}

function smooth(values: number[], radius: number): number[] {
  return values.map((_, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    let sum = 0;
    for (let i = start; i <= end; i++) sum += values[i];
    return sum / (end - start + 1);
  });
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
}

function longestActiveBand(values: number[], minIndex: number, maxIndex: number, threshold: number): { start: number; end: number; coverage: number } | null {
  let best: { start: number; end: number; coverage: number } | null = null;
  let start: number | null = null;
  let activeCount = 0;

  for (let i = minIndex; i <= maxIndex; i++) {
    const active = values[i] >= threshold;
    if (active && start === null) {
      start = i;
      activeCount = 0;
    }
    if (active && start !== null) activeCount++;
    if ((!active || i === maxIndex) && start !== null) {
      const end = active ? i : i - 1;
      const width = end - start + 1;
      const coverage = activeCount / Math.max(1, width);
      if (width >= 10 && (!best || width * coverage > (best.end - best.start + 1) * best.coverage)) {
        best = { start, end, coverage };
      }
      start = null;
      activeCount = 0;
    }
  }

  return best;
}

function imageDataForDetection(bitmap: ImageBitmap): { data: Uint8ClampedArray; width: number; height: number } | null {
  const maxWidth = 900;
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return { data: imageData.data, width, height };
}

function detectPowerScribeStudyListCropFromBitmap(bitmap: ImageBitmap): DetectedCrop {
  const image = imageDataForDetection(bitmap);
  if (!image) {
    return { rect: DEFAULT_POWERSCRIBE_STUDY_LIST_CROP, confidence: 0, method: 'fallback' };
  }

  const { data, width, height } = image;
  const rowSignal = Array.from({ length: height }, () => 0);
  const colSignal = Array.from({ length: width }, () => 0);

  const xMin = Math.floor(width * 0.18);
  const xMax = Math.floor(width * 0.98);
  const yMin = Math.floor(height * 0.2);
  const yMax = Math.floor(height * 0.965);

  for (let y = yMin + 1; y < yMax; y++) {
    for (let x = xMin + 1; x < xMax; x++) {
      const index = (y * width + x) * 4;
      const leftIndex = (y * width + x - 1) * 4;
      const upIndex = ((y - 1) * width + x) * 4;
      const luminance = (data[index] + data[index + 1] + data[index + 2]) / 3;
      const leftLum = (data[leftIndex] + data[leftIndex + 1] + data[leftIndex + 2]) / 3;
      const upLum = (data[upIndex] + data[upIndex + 1] + data[upIndex + 2]) / 3;
      const contrast = Math.max(Math.abs(luminance - leftLum), Math.abs(luminance - upLum));
      const content = contrast > 18 || luminance < 88;
      if (content) {
        rowSignal[y] += 1;
        colSignal[x] += 1;
      }
    }
  }

  const smoothedRows = smooth(rowSignal.map((v) => v / Math.max(1, xMax - xMin)), 5);
  const smoothedCols = smooth(colSignal.map((v) => v / Math.max(1, yMax - yMin)), 6);
  const rowThreshold = Math.max(0.015, percentile(smoothedRows.slice(yMin, yMax), 0.78));
  const colThreshold = Math.max(0.01, percentile(smoothedCols.slice(xMin, xMax), 0.70));
  const rowBand = longestActiveBand(smoothedRows, yMin, yMax, rowThreshold);
  const colBand = longestActiveBand(smoothedCols, xMin, xMax, colThreshold);

  if (!rowBand || !colBand) {
    return { rect: DEFAULT_POWERSCRIBE_STUDY_LIST_CROP, confidence: 0.2, method: 'fallback' };
  }

  const detected = boundToStudyListArea({
    x: colBand.start / width - 0.02,
    y: rowBand.start / height - 0.015,
    width: Math.min(0.8, (Math.min(width - 1, colBand.end + Math.round(width * 0.035)) / width) - (colBand.start / width - 0.02)),
    height: Math.min(0.78, (Math.min(height - 1, rowBand.end + Math.round(height * 0.025)) / height) - (rowBand.start / height - 0.015)),
  });

  const rowCoverage = (rowBand.end - rowBand.start + 1) / Math.max(1, yMax - yMin);
  const colCoverage = (colBand.end - colBand.start + 1) / Math.max(1, xMax - xMin);
  const confidence = Math.max(0, Math.min(1, (rowCoverage * 0.65 + colCoverage * 0.35) * rowBand.coverage * 1.8));

  if (confidence < 0.35 || detected.width < 0.45 || detected.height < 0.22) {
    return { rect: DEFAULT_POWERSCRIBE_STUDY_LIST_CROP, confidence, method: 'fallback' };
  }

  return { rect: detected, confidence, method: 'pixelValley' };
}

async function blobFromBitmapCrop(bitmap: ImageBitmap, cropRect: RelativeCropRect, outputType: string): Promise<Blob> {
  const rect = normalizeCrop(cropRect);
  const sx = Math.round(rect.x * bitmap.width);
  const sy = Math.round(rect.y * bitmap.height);
  const sw = Math.max(1, Math.round(rect.width * bitmap.width));
  const sh = Math.max(1, Math.round(rect.height * bitmap.height));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available for OCR crop');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas crop export failed'));
    }, outputType);
  });
}

export async function detectPowerScribeStudyListCrop(image: File | Blob): Promise<DetectedCrop> {
  const bitmap = await createImageBitmap(image);
  try {
    return detectPowerScribeStudyListCropFromBitmap(bitmap);
  } finally {
    bitmap.close();
  }
}

export async function cropImageBlob(
  image: File | Blob,
  cropRect: RelativeCropRect,
  outputType = 'image/png',
): Promise<Blob> {
  const bitmap = await createImageBitmap(image);
  try {
    return await blobFromBitmapCrop(bitmap, cropRect, outputType);
  } finally {
    bitmap.close();
  }
}

export async function cropPowerScribeScreenshot(
  image: File | Blob,
  cropRect?: RelativeCropRect | null,
  outputType = 'image/png',
): Promise<Blob> {
  return (await cropPowerScribeScreenshotWithDebug(image, cropRect, outputType)).blob;
}

function absoluteRectFromRelative(rect: RelativeCropRect, width: number, height: number) {
  const normalized = normalizeCrop(rect);
  return {
    x: Math.round(normalized.x * width),
    y: Math.round(normalized.y * height),
    width: Math.max(1, Math.round(normalized.width * width)),
    height: Math.max(1, Math.round(normalized.height * height)),
  };
}

function childRect(parent: RelativeCropRect, child: RelativeCropRect): RelativeCropRect {
  const p = normalizeCrop(parent);
  const c = normalizeCrop(child);
  return normalizeCrop({
    x: p.x + p.width * c.x,
    y: p.y + p.height * c.y,
    width: p.width * c.width,
    height: p.height * c.height,
  });
}

export function __testBoundToStudyListArea(rect: RelativeCropRect): RelativeCropRect {
  return boundToStudyListArea(rect);
}

interface PowerScribeColumnLayout {
  threeColumnRect: RelativeCropRect;
  columns: Record<PowerScribeColumnName, RelativeCropRect>;
  confidence: number;
  method: 'detected' | 'fallback';
}

const FALLBACK_COLUMN_LAYOUT: PowerScribeColumnLayout = {
  threeColumnRect: { x: 0.13, y: 0, width: 0.865, height: 1 },
  columns: {
    procedure: { x: 0.13, y: 0, width: 0.41, height: 1 },
    examDate: { x: 0.54, y: 0, width: 0.22, height: 1 },
    modifiedDate: { x: 0.76, y: 0, width: 0.235, height: 1 },
  },
  confidence: 0.45,
  method: 'fallback',
};

function fallbackColumnLayout(): PowerScribeColumnLayout {
  return {
    ...FALLBACK_COLUMN_LAYOUT,
    threeColumnRect: { ...FALLBACK_COLUMN_LAYOUT.threeColumnRect },
    columns: {
      procedure: { ...FALLBACK_COLUMN_LAYOUT.columns.procedure },
      examDate: { ...FALLBACK_COLUMN_LAYOUT.columns.examDate },
      modifiedDate: { ...FALLBACK_COLUMN_LAYOUT.columns.modifiedDate },
    },
  };
}

function bestGutterBand(
  values: number[],
  minRatio: number,
  maxRatio: number,
  threshold: number,
): { center: number; width: number; score: number } | null {
  const minIndex = Math.max(0, Math.floor(values.length * minRatio));
  const maxIndex = Math.min(values.length - 1, Math.ceil(values.length * maxRatio));
  const minWidth = Math.max(6, Math.round(values.length * 0.012));
  let best: { center: number; width: number; score: number } | null = null;
  let start: number | null = null;
  let sum = 0;

  for (let i = minIndex; i <= maxIndex; i++) {
    const low = values[i] <= threshold;
    if (low && start === null) {
      start = i;
      sum = 0;
    }
    if (low) sum += values[i];
    if ((!low || i === maxIndex) && start !== null) {
      const end = low ? i : i - 1;
      const width = end - start + 1;
      if (width >= minWidth) {
        const average = sum / Math.max(1, width);
        const score = width * Math.max(0.0001, threshold - average);
        if (!best || score > best.score) {
          best = { center: (start + end) / 2 / values.length, width: width / values.length, score };
        }
      }
      start = null;
      sum = 0;
    }
  }

  return best;
}

function detectPowerScribeColumnLayoutFromProjection(projection: number[]): PowerScribeColumnLayout {
  if (projection.length < 80) return fallbackColumnLayout();

  const smoothed = smooth(projection, Math.max(2, Math.round(projection.length * 0.006)));
  const searchValues = smoothed.slice(Math.floor(smoothed.length * 0.10), Math.floor(smoothed.length * 0.96));
  const lowThreshold = Math.max(0.0015, percentile(searchValues, 0.24));
  const firstGutter = bestGutterBand(smoothed, 0.45, 0.68, lowThreshold);
  const secondGutter = bestGutterBand(smoothed, 0.66, 0.90, lowThreshold);

  if (!firstGutter || !secondGutter || secondGutter.center - firstGutter.center < 0.10) {
    return fallbackColumnLayout();
  }

  const padding = 0.012;
  const left = 0.13;
  const right = 0.99;
  const procedureRight = Math.max(0.34, firstGutter.center - padding);
  const examLeft = Math.min(0.72, firstGutter.center + padding);
  const examRight = Math.max(examLeft + 0.10, secondGutter.center - padding);
  const modifiedLeft = Math.min(0.88, secondGutter.center + padding);

  if (procedureRight <= left + 0.18 || examRight <= examLeft + 0.08 || right <= modifiedLeft + 0.08) {
    return fallbackColumnLayout();
  }

  const confidence = Math.max(0.55, Math.min(0.95, 0.60 + firstGutter.width * 6 + secondGutter.width * 6));
  return {
    threeColumnRect: normalizeCrop({ x: left, y: 0, width: right - left, height: 1 }),
    columns: {
      procedure: normalizeCrop({ x: left, y: 0, width: procedureRight - left, height: 1 }),
      examDate: normalizeCrop({ x: examLeft, y: 0, width: examRight - examLeft, height: 1 }),
      modifiedDate: normalizeCrop({ x: modifiedLeft, y: 0, width: right - modifiedLeft, height: 1 }),
    },
    confidence,
    method: 'detected',
  };
}

function detectPowerScribeColumnLayoutFromBitmap(bitmap: ImageBitmap, tableRect: RelativeCropRect): PowerScribeColumnLayout {
  const source = absoluteRectFromRelative(tableRect, bitmap.width, bitmap.height);
  const maxWidth = 900;
  const scale = Math.min(1, maxWidth / source.width);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return fallbackColumnLayout();
  ctx.drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height).data;
  const projection = Array.from({ length: width }, () => 0);
  const yMin = Math.floor(height * 0.06);
  const yMax = Math.floor(height * 0.98);

  for (let y = yMin + 1; y < yMax; y++) {
    for (let x = 1; x < width - 1; x++) {
      const offset = (y * width + x) * 4;
      const leftOffset = (y * width + x - 1) * 4;
      const lum = imageData[offset] * 0.299 + imageData[offset + 1] * 0.587 + imageData[offset + 2] * 0.114;
      const leftLum = imageData[leftOffset] * 0.299 + imageData[leftOffset + 1] * 0.587 + imageData[leftOffset + 2] * 0.114;
      if (lum < 150 || Math.abs(lum - leftLum) > 28) {
        projection[x] += 1;
      }
    }
  }

  return detectPowerScribeColumnLayoutFromProjection(projection.map((value) => value / Math.max(1, yMax - yMin)));
}

export function __testDetectPowerScribeColumnLayoutFromProjection(projection: number[]): PowerScribeColumnLayout {
  return detectPowerScribeColumnLayoutFromProjection(projection);
}

function adaptiveThreshold(imageData: ImageData, width: number, height: number): ImageData {
  const source = imageData.data;
  const gray = new Uint8ClampedArray(width * height);
  const integral = new Float64Array((width + 1) * (height + 1));

  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const raw = source[offset] * 0.299 + source[offset + 1] * 0.587 + source[offset + 2] * 0.114;
      const contrasted = Math.max(0, Math.min(255, (raw - 128) * 1.55 + 128));
      gray[y * width + x] = contrasted;
      rowSum += contrasted;
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + rowSum;
    }
  }

  const output = new ImageData(width, height);
  const target = output.data;
  const radius = 14;
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * (width + 1) + x1 + 1] -
        integral[y0 * (width + 1) + x1 + 1] -
        integral[(y1 + 1) * (width + 1) + x0] +
        integral[y0 * (width + 1) + x0];
      const threshold = sum / area - 7;
      const value = gray[y * width + x] < threshold ? 0 : 255;
      const offset = (y * width + x) * 4;
      target[offset] = value;
      target[offset + 1] = value;
      target[offset + 2] = value;
      target[offset + 3] = 255;
    }
  }

  return output;
}

async function preprocessedBlobFromBitmapCrop(bitmap: ImageBitmap, cropRect: RelativeCropRect, outputType: string, scale: number): Promise<Blob> {
  const source = absoluteRectFromRelative(cropRect, bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not available for OCR preprocessing');

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  ctx.putImageData(adaptiveThreshold(imageData, canvas.width, canvas.height), 0, 0);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas preprocessing export failed'));
    }, outputType);
  });
}

export async function cropPowerScribeScreenshotWithDebug(
  image: File | Blob,
  cropRect?: RelativeCropRect | null,
  outputType = 'image/png',
): Promise<CroppedImageResult> {
  const bitmap = await createImageBitmap(image);
  try {
    const crop: DetectedCrop = cropRect
      ? { rect: normalizeCrop(cropRect), confidence: 1, method: 'fallback' }
      : detectPowerScribeStudyListCropFromBitmap(bitmap);
    const blob = await blobFromBitmapCrop(bitmap, crop.rect, outputType);
    return { blob, crop };
  } finally {
    bitmap.close();
  }
}

export async function preprocessPowerScribeColumnsForOcr(
  image: File | Blob,
  options: PowerScribePreprocessOptions = {},
  outputType = 'image/png',
): Promise<PowerScribeColumnPreprocessResult> {
  const bitmap = await createImageBitmap(image);
  try {
    const headerLayout = detectPowerScribeHeaderLayout(options.headerWords ?? [], bitmap.width, bitmap.height);
    const datetimeLayout = headerLayout
      ? null
      : detectPowerScribeDatetimeLayout(options.headerWords ?? [], bitmap.width, bitmap.height);
    const structuralLayout = headerLayout ?? datetimeLayout;
    const signalWords = new Set((options.headerWords ?? []).map((word) => word.text.toUpperCase().replace(/[^A-Z]/g, '')));
    const hasPowerScribeSignal = ['PROCEDURE', 'EXAM', 'EXAMDATE', 'MODIFIED', 'MYREPORTS']
      .some((signal) => signalWords.has(signal));
    const pixelCrop = detectPowerScribeStudyListCropFromBitmap(bitmap);
    const selectedTier = selectPowerScribeCropTier({
      manual: Boolean(options.manualCrop),
      headerAnchors: Boolean(headerLayout),
      datetimeColumns: Boolean(datetimeLayout),
      pixelValley: pixelCrop.method === 'pixelValley',
      savedCrop: Boolean(options.savedCrop),
      hasPowerScribeSignal,
    });
    let tableCrop: DetectedCrop;
    if (selectedTier === 'manual' && options.manualCrop) {
      tableCrop = { rect: normalizeCrop(options.manualCrop), confidence: 1, method: 'manual' };
    } else if (selectedTier === 'headerAnchors' && headerLayout) {
      tableCrop = { rect: normalizeCrop(headerLayout.tableRect), confidence: 1, method: 'headerAnchors' };
    } else if (selectedTier === 'datetimeColumns' && datetimeLayout) {
      tableCrop = { rect: normalizeCrop(datetimeLayout.tableRect), confidence: 0.9, method: 'datetimeColumns' };
    } else if (selectedTier === 'pixelValley' && pixelCrop.method === 'pixelValley') {
      tableCrop = pixelCrop;
    } else if (selectedTier === 'savedCrop' && options.savedCrop) {
      tableCrop = { rect: normalizeCrop(options.savedCrop), confidence: 0.8, method: 'savedCrop' };
    } else {
      throw new PowerScribeTableNotFoundError();
    }
    const valleyLayout = detectPowerScribeColumnLayoutFromBitmap(bitmap, tableCrop.rect);
    const columnLayout: PowerScribeColumnLayout = structuralLayout && (tableCrop.method === 'headerAnchors' || tableCrop.method === 'datetimeColumns')
      ? {
          threeColumnRect: {
            x: structuralLayout.columns.procedure.x,
            y: 0,
            width: 1 - structuralLayout.columns.procedure.x,
            height: 1,
          },
          columns: structuralLayout.columns,
          confidence: 1,
          method: 'detected',
        }
      : valleyLayout;
    const threeColumnCrop: DetectedCrop = {
      rect: childRect(tableCrop.rect, columnLayout.threeColumnRect),
      confidence: columnLayout.confidence,
      method: tableCrop.method === 'headerAnchors' || tableCrop.method === 'datetimeColumns'
        ? tableCrop.method
        : columnLayout.method === 'detected' ? 'pixelValley' : tableCrop.method,
    };
    const columnDefinitions: Array<{ name: PowerScribeColumnName; rect: RelativeCropRect }> = [
      { name: 'procedure', rect: childRect(tableCrop.rect, columnLayout.columns.procedure) },
      { name: 'examDate', rect: childRect(tableCrop.rect, columnLayout.columns.examDate) },
      { name: 'modifiedDate', rect: childRect(tableCrop.rect, columnLayout.columns.modifiedDate) },
    ];
    const pitch = structuralLayout?.bandPitch ?? null;
    const preprocessScale = pitch == null ? 3 : Math.max(1.5, Math.min(4, 36 / Math.max(9, pitch * 0.55)));
    const columns: PowerScribeColumnCrop[] = [];
    for (const column of columnDefinitions) {
      columns.push({
        name: column.name,
        rect: column.rect,
        blob: await preprocessedBlobFromBitmapCrop(bitmap, column.rect, outputType, preprocessScale),
      });
    }
    const headerValleyDrift = structuralLayout && valleyLayout.method === 'detected'
      ? Math.max(
          Math.abs(structuralLayout.columns.examDate.x - valleyLayout.columns.examDate.x),
          Math.abs(structuralLayout.columns.modifiedDate.x - valleyLayout.columns.modifiedDate.x),
        )
      : null;
    return {
      tableCrop,
      threeColumnCrop,
      columns,
      accounting: {
        engine: 'tesseract.js',
        cropMethod: tableCrop.method,
        imageWidth: bitmap.width,
        imageHeight: bitmap.height,
        modifiedAnchorCount: structuralLayout?.modifiedAnchorCount ?? 0,
        bandPitch: pitch,
        preprocessScale,
        headerValleyDrift,
        inputRowCount: 0,
        outputRowCount: 0,
      },
    };
  } finally {
    bitmap.close();
  }
}
