import { detectPowerScribeDatetimeLayout, detectPowerScribeHeaderLayout, type PowerScribeOcrWord } from './powerScribeHeaderAnchors';
import {
  POWERSCRIBE_PRODUCTION_PREPROCESSING,
  preprocessPowerScribeRgba,
  resolvePowerScribePreprocessScale,
  type PowerScribePreprocessConfig,
} from './powerScribePreprocessing';

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

export type PowerScribeManualColumnCrops = Record<PowerScribeColumnName, RelativeCropRect>;

export interface PowerScribeRowBand {
  top: number;
  bottom: number;
}

export interface PowerScribeRowSlot extends PowerScribeRowBand {
  index: number;
  compositeTop: number;
  compositeBottom: number;
}

export interface PowerScribeManualColumnGuides {
  left: number;
  procedureEnd: number;
  examEnd: number;
  right: number;
  top: number;
  bottom: number;
}

export const DEFAULT_POWERSCRIBE_MANUAL_COLUMN_GUIDES: PowerScribeManualColumnGuides = {
  left: 0.2,
  procedureEnd: 0.58,
  examEnd: 0.78,
  right: 0.98,
  top: 0.1,
  bottom: 0.95,
};

export function powerScribeManualColumnsFromGuides(
  guides: PowerScribeManualColumnGuides,
): PowerScribeManualColumnCrops {
  const left = Math.min(0.85, clamp01(guides.left));
  const right = Math.max(left + 0.15, clamp01(guides.right));
  const procedureEnd = Math.max(left + 0.05, Math.min(right - 0.1, clamp01(guides.procedureEnd)));
  const examEnd = Math.max(procedureEnd + 0.05, Math.min(right - 0.05, clamp01(guides.examEnd)));
  const top = Math.min(0.95, clamp01(guides.top));
  const bottom = Math.max(top + 0.05, clamp01(guides.bottom));
  const height = Math.min(1, bottom) - top;
  return {
    procedure: normalizeCrop({ x: left, y: top, width: procedureEnd - left, height }),
    examDate: normalizeCrop({ x: procedureEnd, y: top, width: examEnd - procedureEnd, height }),
    modifiedDate: normalizeCrop({ x: examEnd, y: top, width: Math.min(1, right) - examEnd, height }),
  };
}

export interface PowerScribeColumnCrop {
  name: PowerScribeColumnName;
  blob: Blob;
  rect: RelativeCropRect;
  outputWidth: number;
  outputHeight: number;
}

export interface PowerScribePreprocessedCell {
  rowIndex: number;
  column: PowerScribeColumnName;
  sourceRect: RelativeCropRect;
  compositeTop: number;
  compositeBottom: number;
}

export interface PowerScribeColumnPreprocessResult {
  tableCrop: DetectedCrop;
  threeColumnCrop: DetectedCrop;
  columns: PowerScribeColumnCrop[];
  rowBands: PowerScribeRowBand[];
  rowSlots: PowerScribeRowSlot[];
  cells: PowerScribePreprocessedCell[];
  accounting: PowerScribeCropAccounting;
}

export interface PowerScribeCropAccounting {
  engine: 'tesseract.js' | 'text-detector';
  cropMethod: DetectedCrop['method'];
  imageWidth: number;
  imageHeight: number;
  modifiedAnchorCount: number;
  detectedRowCount: number;
  bandPitch: number | null;
  preprocessScale: number;
  preprocessingVariant: string;
  ocrConfigurationVariant?: string;
  decodeDurationMs: number;
  cropSplitDurationMs: number;
  preprocessingDurationMs: number;
  headerValleyDrift: number | null;
  inputRowCount: number;
  outputRowCount: number;
}

export interface PowerScribePreprocessOptions {
  manualCrop?: RelativeCropRect | null;
  manualColumns?: PowerScribeManualColumnCrops | null;
  manualRows?: PowerScribeRowBand[] | null;
  savedCrop?: RelativeCropRect | null;
  headerWords?: PowerScribeOcrWord[];
  preprocessingConfig?: PowerScribePreprocessConfig;
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

function medianValue(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function normalizePowerScribeRowBands(
  bands: PowerScribeRowBand[],
  range?: { top: number; bottom: number },
): PowerScribeRowBand[] {
  const minTop = clamp01(range?.top ?? 0);
  const maxBottom = Math.max(minTop + 0.005, clamp01(range?.bottom ?? 1));
  const sorted = bands
    .map((band) => ({
      top: Math.max(minTop, Math.min(maxBottom, clamp01(band.top))),
      bottom: Math.max(minTop, Math.min(maxBottom, clamp01(band.bottom))),
    }))
    .filter((band) => band.bottom - band.top >= 0.003)
    .sort((a, b) => a.top - b.top);
  if (sorted.length === 0) return [];

  const boundaries = [sorted[0].top];
  for (let index = 0; index < sorted.length - 1; index++) {
    boundaries.push((sorted[index].bottom + sorted[index + 1].top) / 2);
  }
  boundaries.push(sorted.at(-1)!.bottom);

  const normalized: PowerScribeRowBand[] = [];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const top = Math.max(minTop, boundaries[index]);
    const bottom = Math.min(maxBottom, boundaries[index + 1]);
    if (bottom - top >= 0.003) normalized.push({ top, bottom });
  }
  return normalized;
}

export function detectPowerScribeRowBandsFromProjection(
  projection: number[],
  range: { top: number; bottom: number } = { top: 0, bottom: 1 },
): PowerScribeRowBand[] {
  if (projection.length < 8) return [];
  const smoothed = smooth(projection, 1);
  const baseline = percentile(smoothed, 0.5);
  const high = percentile(smoothed, 0.9);
  const threshold = baseline + Math.max(0.002, (high - baseline) * 0.28);
  const groups: Array<{ start: number; end: number; score: number }> = [];
  let start: number | null = null;
  let lastActive = -1;
  let score = 0;

  for (let index = 0; index < smoothed.length; index++) {
    const active = smoothed[index] >= threshold && smoothed[index] > baseline * 1.08;
    if (active) {
      if (start === null) start = index;
      lastActive = index;
      score += Math.max(0, smoothed[index] - baseline);
    }
    const gapEnded = start !== null && index - lastActive > 1;
    if (gapEnded || (index === smoothed.length - 1 && start !== null)) {
      groups.push({ start: start!, end: lastActive, score });
      start = null;
      score = 0;
    }
  }
  if (groups.length < 2) return [];

  const centers = groups
    .map((group) => ({
      center: (group.start + group.end) / 2,
      score: group.score,
    }))
    .sort((a, b) => a.center - b.center);
  const rawPitches = centers
    .slice(1)
    .map((center, index) => center.center - centers[index].center)
    .filter((pitch) => pitch >= 3);
  const pitch = medianValue(rawPitches) ?? Math.max(4, projection.length / centers.length);
  const minimumSeparation = Math.max(2, pitch * 0.42);
  const filtered: typeof centers = [];
  for (const center of centers) {
    const previous = filtered.at(-1);
    if (!previous || center.center - previous.center >= minimumSeparation) {
      filtered.push(center);
    } else if (center.score > previous.score) {
      filtered[filtered.length - 1] = center;
    }
  }
  if (filtered.length < 2) return [];

  const rangeHeight = Math.max(0.005, range.bottom - range.top);
  const boundaries = [Math.max(0, filtered[0].center - pitch / 2)];
  for (let index = 0; index < filtered.length - 1; index++) {
    boundaries.push((filtered[index].center + filtered[index + 1].center) / 2);
  }
  boundaries.push(Math.min(projection.length, filtered.at(-1)!.center + pitch / 2));
  return normalizePowerScribeRowBands(
    boundaries.slice(0, -1).map((boundary, index) => ({
      top: range.top + (boundary / projection.length) * rangeHeight,
      bottom: range.top + (boundaries[index + 1] / projection.length) * rangeHeight,
    })),
    range,
  );
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

function enclosingRect(rects: RelativeCropRect[]): RelativeCropRect {
  const normalized = rects.map(normalizeCrop);
  const x = Math.min(...normalized.map((rect) => rect.x));
  const y = Math.min(...normalized.map((rect) => rect.y));
  const right = Math.max(...normalized.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...normalized.map((rect) => rect.y + rect.height));
  return normalizeCrop({ x, y, width: right - x, height: bottom - y });
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

function detectPowerScribeRowBandsFromBitmap(
  bitmap: ImageBitmap,
  columns: PowerScribeManualColumnCrops,
): PowerScribeRowBand[] {
  const image = imageDataForDetection(bitmap);
  if (!image) return [];
  const { data, width, height } = image;
  const dateColumns = [columns.examDate, columns.modifiedDate].map(normalizeCrop);
  const top = Math.max(0, Math.min(...dateColumns.map((column) => column.y)));
  const bottom = Math.min(1, Math.max(...dateColumns.map((column) => column.y + column.height)));
  const yStart = Math.max(1, Math.floor(top * height));
  const yEnd = Math.min(height - 1, Math.ceil(bottom * height));
  const xRanges = dateColumns.map((column) => {
    const inset = Math.min(column.width * 0.06, 0.012);
    return {
      start: Math.max(1, Math.floor((column.x + inset) * width)),
      end: Math.min(width - 1, Math.ceil((column.x + column.width - inset) * width)),
    };
  });
  const sampledLuminance: number[] = [];
  for (let y = yStart; y < yEnd; y += 2) {
    for (const range of xRanges) {
      for (let x = range.start; x < range.end; x += 3) {
        const offset = (y * width + x) * 4;
        sampledLuminance.push(data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114);
      }
    }
  }
  const darkThreshold = Math.min(190, percentile(sampledLuminance, 0.24) + 14);
  const projection = Array.from({ length: Math.max(1, yEnd - yStart) }, () => 0);

  for (let y = yStart; y < yEnd; y++) {
    let ink = 0;
    let sampled = 0;
    for (const range of xRanges) {
      for (let x = range.start; x < range.end; x++) {
        const offset = (y * width + x) * 4;
        const upOffset = ((y - 1) * width + x) * 4;
        const luminance = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
        const upLuminance = data[upOffset] * 0.299 + data[upOffset + 1] * 0.587 + data[upOffset + 2] * 0.114;
        if (luminance <= darkThreshold || Math.abs(luminance - upLuminance) > 30) ink++;
        sampled++;
      }
    }
    const coverage = ink / Math.max(1, sampled);
    // Full-width rules are table chrome, not text baselines.
    projection[y - yStart] = coverage > 0.62 ? 0 : coverage;
  }

  return detectPowerScribeRowBandsFromProjection(projection, {
    top: yStart / height,
    bottom: yEnd / height,
  });
}

export async function detectPowerScribeRowBands(
  image: File | Blob,
  columns: PowerScribeManualColumnCrops,
): Promise<PowerScribeRowBand[]> {
  const bitmap = await createImageBitmap(image);
  try {
    return detectPowerScribeRowBandsFromBitmap(bitmap, columns);
  } finally {
    bitmap.close();
  }
}

export function __testDetectPowerScribeColumnLayoutFromProjection(projection: number[]): PowerScribeColumnLayout {
  return detectPowerScribeColumnLayoutFromProjection(projection);
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function applyPreprocessing(imageData: ImageData, config: PowerScribePreprocessConfig): ImageData {
  const processed = preprocessPowerScribeRgba({
    data: imageData.data,
    width: imageData.width,
    height: imageData.height,
  }, config);
  const output = new ImageData(processed.width, processed.height);
  output.data.set(processed.data);
  return output;
}

interface RenderedPreprocessedImage {
  blob: Blob;
  width: number;
  height: number;
  durationMs: number;
}

async function preprocessedBlobFromBitmapCrop(
  bitmap: ImageBitmap,
  cropRect: RelativeCropRect,
  outputType: string,
  scale: number,
  config: PowerScribePreprocessConfig,
): Promise<RenderedPreprocessedImage> {
  const startedAt = nowMs();
  const source = absoluteRectFromRelative(cropRect, bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not available for OCR preprocessing');

  ctx.imageSmoothingEnabled = scale !== 1 && config.imageSmoothingEnabled;
  ctx.imageSmoothingQuality = config.imageSmoothingQuality;
  ctx.drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  ctx.putImageData(applyPreprocessing(imageData, config), 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas preprocessing export failed'));
    }, outputType);
  });
  return { blob, width: canvas.width, height: canvas.height, durationMs: nowMs() - startedAt };
}

function buildPowerScribeRowSlots(
  bands: PowerScribeRowBand[],
  imageHeight: number,
  scale: number,
  cellPaddingPx: number,
): PowerScribeRowSlot[] {
  const padding = Math.max(8, Math.round(scale * 4));
  const sourcePadding = Math.max(0, cellPaddingPx) / Math.max(1, imageHeight);
  let cursor = padding;
  return bands.map((band, index) => {
    const previousBoundary = index === 0 ? 0 : (bands[index - 1].bottom + band.top) / 2;
    const nextBoundary = index === bands.length - 1 ? 1 : (band.bottom + bands[index + 1].top) / 2;
    const top = Math.max(previousBoundary, band.top - sourcePadding);
    const bottom = Math.min(nextBoundary, band.bottom + sourcePadding);
    const slotHeight = Math.max(8, Math.round((bottom - top) * imageHeight * scale));
    const slot: PowerScribeRowSlot = {
      top,
      bottom,
      index,
      compositeTop: cursor,
      compositeBottom: cursor + slotHeight,
    };
    cursor += slotHeight + padding;
    return slot;
  });
}

async function preprocessedStackedRowsBlob(
  bitmap: ImageBitmap,
  columnRect: RelativeCropRect,
  rowSlots: PowerScribeRowSlot[],
  outputType: string,
  scale: number,
  config: PowerScribePreprocessConfig,
): Promise<RenderedPreprocessedImage> {
  const startedAt = nowMs();
  const column = absoluteRectFromRelative(columnRect, bitmap.width, bitmap.height);
  const padding = Math.max(8, Math.round(scale * 4));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(column.width * scale));
  canvas.height = Math.max(padding, (rowSlots.at(-1)?.compositeBottom ?? 0) + padding);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not available for row OCR preprocessing');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = scale !== 1 && config.imageSmoothingEnabled;
  ctx.imageSmoothingQuality = config.imageSmoothingQuality;

  for (const slot of rowSlots) {
    const sourceY = Math.max(0, Math.round(slot.top * bitmap.height));
    const sourceBottom = Math.min(bitmap.height, Math.round(slot.bottom * bitmap.height));
    const sourceHeight = Math.max(1, sourceBottom - sourceY);
    const targetHeight = Math.max(1, slot.compositeBottom - slot.compositeTop);
    ctx.drawImage(
      bitmap,
      column.x,
      sourceY,
      column.width,
      sourceHeight,
      0,
      slot.compositeTop,
      canvas.width,
      targetHeight,
    );
    const cellData = ctx.getImageData(0, slot.compositeTop, canvas.width, targetHeight);
    ctx.putImageData(applyPreprocessing(cellData, config), 0, slot.compositeTop);
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Row OCR preprocessing export failed'));
    }, outputType);
  });
  return { blob, width: canvas.width, height: canvas.height, durationMs: nowMs() - startedAt };
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
  const decodeStartedAt = nowMs();
  const bitmap = await createImageBitmap(image);
  const decodeDurationMs = nowMs() - decodeStartedAt;
  const cropSplitStartedAt = nowMs();
  try {
    const preprocessingConfig = options.preprocessingConfig ?? POWERSCRIBE_PRODUCTION_PREPROCESSING;
    const headerLayout = detectPowerScribeHeaderLayout(options.headerWords ?? [], bitmap.width, bitmap.height);
    const datetimeLayout = headerLayout
      ? null
      : detectPowerScribeDatetimeLayout(options.headerWords ?? [], bitmap.width, bitmap.height);
    const structuralLayout = headerLayout ?? datetimeLayout;
    const signalWords = new Set((options.headerWords ?? []).map((word) => word.text.toUpperCase().replace(/[^A-Z]/g, '')));
    const hasPowerScribeSignal = ['PROCEDURE', 'EXAM', 'EXAMDATE', 'MODIFIED', 'MYREPORTS']
      .some((signal) => signalWords.has(signal));
    const pixelCrop = detectPowerScribeStudyListCropFromBitmap(bitmap);
    const manualColumns = options.manualColumns
      ? {
          procedure: normalizeCrop(options.manualColumns.procedure),
          examDate: normalizeCrop(options.manualColumns.examDate),
          modifiedDate: normalizeCrop(options.manualColumns.modifiedDate),
        }
      : null;
    const manualTableRect = manualColumns ? enclosingRect(Object.values(manualColumns)) : null;
    const selectedTier = selectPowerScribeCropTier({
      manual: Boolean(options.manualCrop || manualColumns),
      headerAnchors: Boolean(headerLayout),
      datetimeColumns: Boolean(datetimeLayout),
      pixelValley: pixelCrop.method === 'pixelValley',
      savedCrop: Boolean(options.savedCrop),
      hasPowerScribeSignal,
    });
    let tableCrop: DetectedCrop;
    if (selectedTier === 'manual' && (options.manualCrop || manualTableRect)) {
      tableCrop = { rect: normalizeCrop(options.manualCrop ?? manualTableRect!), confidence: 1, method: 'manual' };
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
      rect: manualTableRect ?? childRect(tableCrop.rect, columnLayout.threeColumnRect),
      confidence: columnLayout.confidence,
      method: tableCrop.method === 'manual'
        ? 'manual'
        : tableCrop.method === 'headerAnchors' || tableCrop.method === 'datetimeColumns'
        ? tableCrop.method
        : columnLayout.method === 'detected' ? 'pixelValley' : tableCrop.method,
    };
    const columnDefinitions: Array<{ name: PowerScribeColumnName; rect: RelativeCropRect }> = manualColumns
      ? [
          { name: 'procedure', rect: manualColumns.procedure },
          { name: 'examDate', rect: manualColumns.examDate },
          { name: 'modifiedDate', rect: manualColumns.modifiedDate },
        ]
      : [
          { name: 'procedure', rect: childRect(tableCrop.rect, columnLayout.columns.procedure) },
          { name: 'examDate', rect: childRect(tableCrop.rect, columnLayout.columns.examDate) },
          { name: 'modifiedDate', rect: childRect(tableCrop.rect, columnLayout.columns.modifiedDate) },
        ];
    const columnRects = Object.fromEntries(
      columnDefinitions.map((column) => [column.name, column.rect]),
    ) as PowerScribeManualColumnCrops;
    const rowRange = {
      top: Math.min(...columnDefinitions.map((column) => column.rect.y)),
      bottom: Math.max(...columnDefinitions.map((column) => column.rect.y + column.rect.height)),
    };
    const detectedRows = options.manualRows
      ? normalizePowerScribeRowBands(options.manualRows, rowRange)
      : detectPowerScribeRowBandsFromBitmap(bitmap, columnRects);
    const pitch = structuralLayout?.bandPitch ?? null;
    const preprocessScale = resolvePowerScribePreprocessScale(preprocessingConfig, pitch);
    const rowBands = detectedRows.length >= 2 ? detectedRows : [];
    const rowSlots = buildPowerScribeRowSlots(
      rowBands,
      bitmap.height,
      preprocessScale,
      preprocessingConfig.cellPaddingPx,
    );
    const cropSplitDurationMs = nowMs() - cropSplitStartedAt;
    const columns: PowerScribeColumnCrop[] = [];
    const cells: PowerScribePreprocessedCell[] = [];
    let preprocessingDurationMs = 0;
    for (const column of columnDefinitions) {
      const rendered = rowSlots.length > 0
        ? await preprocessedStackedRowsBlob(bitmap, column.rect, rowSlots, outputType, preprocessScale, preprocessingConfig)
        : await preprocessedBlobFromBitmapCrop(bitmap, column.rect, outputType, preprocessScale, preprocessingConfig);
      preprocessingDurationMs += rendered.durationMs;
      columns.push({
        name: column.name,
        rect: column.rect,
        blob: rendered.blob,
        outputWidth: rendered.width,
        outputHeight: rendered.height,
      });
      for (const slot of rowSlots) {
        cells.push({
          rowIndex: slot.index,
          column: column.name,
          sourceRect: {
            x: column.rect.x,
            y: slot.top,
            width: column.rect.width,
            height: slot.bottom - slot.top,
          },
          compositeTop: slot.compositeTop,
          compositeBottom: slot.compositeBottom,
        });
      }
    }
    const headerValleyDrift = !manualColumns && structuralLayout && valleyLayout.method === 'detected'
      ? Math.max(
          Math.abs(structuralLayout.columns.examDate.x - valleyLayout.columns.examDate.x),
          Math.abs(structuralLayout.columns.modifiedDate.x - valleyLayout.columns.modifiedDate.x),
        )
      : null;
    return {
      tableCrop,
      threeColumnCrop,
      columns,
      rowBands,
      rowSlots,
      cells,
      accounting: {
        engine: 'tesseract.js',
        cropMethod: tableCrop.method,
        imageWidth: bitmap.width,
        imageHeight: bitmap.height,
        modifiedAnchorCount: structuralLayout?.modifiedAnchorCount ?? 0,
        detectedRowCount: rowBands.length,
        bandPitch: pitch,
        preprocessScale,
        preprocessingVariant: preprocessingConfig.id,
        decodeDurationMs,
        cropSplitDurationMs,
        preprocessingDurationMs,
        headerValleyDrift,
        inputRowCount: 0,
        outputRowCount: 0,
      },
    };
  } finally {
    bitmap.close();
  }
}
