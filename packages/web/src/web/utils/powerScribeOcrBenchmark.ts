import {
  preprocessPowerScribeColumnsForOcr,
  type PowerScribeColumnName,
  type PowerScribeColumnPreprocessResult,
  type PowerScribeManualColumnCrops,
  type PowerScribeRowBand,
  type PowerScribeRowSlot,
} from './imageCrop';
import { getDefaultOcrEngine, type OcrEngine, type OcrResult } from './ocrProvider';
import {
  POWERSCRIBE_OCR_ENGINE_BASELINE_VARIANTS,
  POWERSCRIBE_PRODUCTION_OCR_CONFIGURATION,
  powerScribeOcrParamsForColumn,
  type PowerScribeOcrEngineConfig,
} from './powerScribeOcrConfiguration';
import {
  POWERSCRIBE_PREPROCESSING_BENCHMARK_VARIANTS,
  POWERSCRIBE_PRODUCTION_PREPROCESSING,
  type PowerScribePreprocessConfig,
} from './powerScribePreprocessing';

export type PowerScribeProcedureVisibility = 'fully-visible' | 'truncated-with-ellipsis' | 'truncated-without-ellipsis';
export type PowerScribeBenchmarkStage =
  | 'engine-baseline'
  | 'scale'
  | 'grayscale'
  | 'contrast'
  | 'threshold'
  | 'sharpening'
  | 'denoising'
  | 'targeted-interaction';

export interface PowerScribeBenchmarkExpectedRow {
  /** Exact visible pixels, including an ellipsis only when it is rendered. */
  procedure: string;
  examDate: string;
  modifiedDate: string;
  procedureVisibility?: PowerScribeProcedureVisibility;
  expectedResolvedProcedure?: string;
}

export interface PowerScribeBenchmarkFixtureMetadata {
  id: string;
  description: string;
  rowCount: number;
  interfaceStates: Array<'normal' | 'selected' | 'tan-background' | 'alternating-background'>;
  includesPriorityIcons: boolean;
  includesBoundaryAdjacentText: boolean;
  fontFamily?: string;
  fontWeight?: string;
  fontSize?: string;
  sourceImageSha256?: string;
  notes?: string[];
}

export interface PowerScribeBenchmarkBaseline {
  fixtureId: string;
  configurationId: string;
  minimumProcedureCharacterAccuracy: number;
  minimumTimestampCharacterAccuracy: number;
  minimumFullRowAccuracy: number;
  maximumMedianTotalMs?: number;
}

export interface PowerScribeBenchmarkFixtureManifest {
  sourceImagePath: string;
  columns: PowerScribeManualColumnCrops;
  rows: PowerScribeRowBand[];
  expectedRows: PowerScribeBenchmarkExpectedRow[];
  metadata: PowerScribeBenchmarkFixtureMetadata;
  baseline?: PowerScribeBenchmarkBaseline;
}

export interface PowerScribeVocabularyResolution {
  resolvedProcedure: string | null;
  confidence: number;
  explanation: string | null;
  requiresReview: boolean;
}

export interface PowerScribeCombinedBenchmarkConfiguration {
  id: string;
  stage: PowerScribeBenchmarkStage;
  preprocessing: Readonly<PowerScribePreprocessConfig>;
  ocr: Readonly<PowerScribeOcrEngineConfig>;
}

export interface PowerScribeBenchmarkInput {
  image: File | Blob;
  columns: PowerScribeManualColumnCrops;
  rows: PowerScribeRowBand[];
  expectedRows: PowerScribeBenchmarkExpectedRow[];
  fixtureMetadata?: PowerScribeBenchmarkFixtureMetadata;
  configurations?: ReadonlyArray<PowerScribeCombinedBenchmarkConfiguration>;
  engine?: OcrEngine;
  repetitions?: number;
  performanceBudgetMs?: number;
  /** Must call the existing W5 institutional-vocabulary ladder; do not supply an independent spell checker. */
  resolveWithInstitutionVocabulary?: (visibleOcrText: string) => Promise<PowerScribeVocabularyResolution>;
}

export interface PowerScribeBenchmarkFieldMetrics {
  characterAccuracy: number;
  exactCells: number;
  totalCells: number;
}

export interface PowerScribeBenchmarkResolutionResult extends PowerScribeVocabularyResolution {
  rowIndex: number;
  visibleOcrText: string;
  expectedResolvedProcedure: string;
  exact: boolean;
}

export interface PowerScribeBenchmarkVariantResult {
  variantId: string;
  stage: PowerScribeBenchmarkStage;
  configuration: Readonly<PowerScribePreprocessConfig>;
  ocrConfiguration: Readonly<PowerScribeOcrEngineConfig>;
  procedure: PowerScribeBenchmarkFieldMetrics;
  examDate: PowerScribeBenchmarkFieldMetrics;
  modifiedDate: PowerScribeBenchmarkFieldMetrics;
  timestampCharacterAccuracy: number;
  exactRows: number;
  totalRows: number;
  fullRowAccuracy: number;
  resolutionAccuracy: number | null;
  resolutionReviewCount: number;
  resolutionResults: PowerScribeBenchmarkResolutionResult[];
  decodeMs: number;
  cropSplitMs: number;
  preprocessingMs: number;
  workerInitializationMs: number;
  ocrMs: number;
  normalizationResolutionMs: number;
  totalMs: number;
  coldTotalMs: number;
  medianTotalMs: number;
  perCellOcrMs: number;
  memoryDeltaBytes: number | null;
  withinPerformanceBudget: boolean | null;
  actualRows: PowerScribeBenchmarkExpectedRow[];
}

const COLUMNS = ['procedure', 'examDate', 'modifiedDate'] as const;
export const POWERSCRIBE_FULL_CAPTURE_PERFORMANCE_BUDGET_MS = 30_000;

export function normalizePowerScribeBenchmarkText(text: string): string {
  return text.toUpperCase().replace(/\s+/g, ' ').trim();
}

export function powerScribeCharacterAccuracy(expectedText: string, actualText: string): number {
  const expected = normalizePowerScribeBenchmarkText(expectedText);
  const actual = normalizePowerScribeBenchmarkText(actualText);
  const width = actual.length + 1;
  const previous = new Uint32Array(width);
  const current = new Uint32Array(width);
  for (let column = 0; column < width; column++) previous[column] = column;
  for (let row = 1; row <= expected.length; row++) {
    current[0] = row;
    for (let column = 1; column <= actual.length; column++) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (expected[row - 1] === actual[column - 1] ? 0 : 1),
      );
    }
    previous.set(current);
  }
  const denominator = Math.max(1, expected.length, actual.length);
  return Math.max(0, 1 - previous[actual.length] / denominator);
}

function scoreField(
  expectedRows: PowerScribeBenchmarkExpectedRow[],
  actualRows: PowerScribeBenchmarkExpectedRow[],
  field: PowerScribeColumnName,
): PowerScribeBenchmarkFieldMetrics {
  const scores = expectedRows.map((expected, index) => powerScribeCharacterAccuracy(expected[field], actualRows[index]?.[field] ?? ''));
  return {
    characterAccuracy: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0,
    exactCells: scores.filter((score) => score === 1).length,
    totalCells: scores.length,
  };
}

function textInSlot(result: OcrResult, slot: PowerScribeRowSlot): string {
  const positioned = result.positionedLines
    .filter((line) => {
      if (!line.bbox) return false;
      const center = (line.bbox.y0 + line.bbox.y1) / 2;
      return center >= slot.compositeTop && center <= slot.compositeBottom;
    })
    .sort((left, right) => (left.bbox?.x0 ?? 0) - (right.bbox?.x0 ?? 0))
    .map((line) => line.text.trim())
    .filter(Boolean);
  if (positioned.length > 0) return positioned.join(' ').replace(/\s+/g, ' ').trim();
  return result.positionedLines.length === 0 ? result.lines[slot.index]?.trim() ?? '' : '';
}

async function cropCompositeCell(
  bitmap: ImageBitmap,
  width: number,
  slot: PowerScribeRowSlot,
): Promise<Blob> {
  const top = Math.max(0, Math.floor(slot.compositeTop));
  const height = Math.max(1, Math.ceil(slot.compositeBottom - slot.compositeTop));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available for OCR benchmark cell extraction.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, top, width, height, 0, 0, width, height);
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('OCR benchmark cell export failed.')),
    'image/png',
  ));
}

async function recognizeStackedColumns(
  preprocessed: PowerScribeColumnPreprocessResult,
  engine: OcrEngine,
  configuration: PowerScribeOcrEngineConfig,
): Promise<{ actualRows: PowerScribeBenchmarkExpectedRow[]; durationMs: number }> {
  const results = {} as Record<PowerScribeColumnName, OcrResult>;
  const startedAt = performance.now();
  for (const column of preprocessed.columns) {
    results[column.name] = await engine.extractText(column.blob, powerScribeOcrParamsForColumn(column.name, configuration));
  }
  return {
    actualRows: preprocessed.rowSlots.map((slot) => ({
      procedure: textInSlot(results.procedure, slot),
      examDate: textInSlot(results.examDate, slot),
      modifiedDate: textInSlot(results.modifiedDate, slot),
    })),
    durationMs: performance.now() - startedAt,
  };
}

async function recognizeIndividualCells(
  preprocessed: PowerScribeColumnPreprocessResult,
  engine: OcrEngine,
  configuration: PowerScribeOcrEngineConfig,
): Promise<{ actualRows: PowerScribeBenchmarkExpectedRow[]; durationMs: number }> {
  const bitmaps = new Map<PowerScribeColumnName, { bitmap: ImageBitmap; width: number }>();
  for (const column of preprocessed.columns) {
    bitmaps.set(column.name, { bitmap: await createImageBitmap(column.blob), width: column.outputWidth });
  }
  const startedAt = performance.now();
  try {
    const actualRows: PowerScribeBenchmarkExpectedRow[] = [];
    for (const slot of preprocessed.rowSlots) {
      const row = { procedure: '', examDate: '', modifiedDate: '' };
      for (const column of COLUMNS) {
        const source = bitmaps.get(column);
        if (!source) throw new Error(`Missing ${column} benchmark column.`);
        const cell = await cropCompositeCell(source.bitmap, source.width, slot);
        const result = await engine.extractText(cell, powerScribeOcrParamsForColumn(column, configuration));
        row[column] = result.rawText.replace(/\s+/g, ' ').trim();
      }
      actualRows.push(row);
    }
    return { actualRows, durationMs: performance.now() - startedAt };
  } finally {
    for (const source of bitmaps.values()) source.bitmap.close();
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function usedHeapBytes(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null;
}

function config(
  preprocessing: Readonly<PowerScribePreprocessConfig>,
  ocr: Readonly<PowerScribeOcrEngineConfig>,
  stage: PowerScribeBenchmarkStage,
): PowerScribeCombinedBenchmarkConfiguration {
  return { id: `${preprocessing.id}__${ocr.id}`, stage, preprocessing, ocr };
}

/** Stage one only. Feed the winner into later stages instead of creating a full Cartesian grid. */
export function initialPowerScribeBenchmarkConfigurations(): PowerScribeCombinedBenchmarkConfiguration[] {
  const minimallyProcessed = POWERSCRIBE_PREPROCESSING_BENCHMARK_VARIANTS.find((candidate) => candidate.id === 'gray-3x');
  if (!minimallyProcessed) throw new Error('Missing gray-3x preprocessing baseline.');
  return POWERSCRIBE_OCR_ENGINE_BASELINE_VARIANTS.map((ocr) => config(minimallyProcessed, ocr, 'engine-baseline'));
}

export const POWERSCRIBE_STAGED_SEARCH: ReadonlyArray<{
  stage: PowerScribeBenchmarkStage;
  candidateIds: string[];
  interactionOnly: boolean;
}> = [
  { stage: 'engine-baseline', candidateIds: POWERSCRIBE_OCR_ENGINE_BASELINE_VARIANTS.map((item) => item.id), interactionOnly: false },
  { stage: 'scale', candidateIds: ['gray-1x', 'gray-2x', 'gray-3x', 'gray-4x'], interactionOnly: false },
  { stage: 'grayscale', candidateIds: ['rgb-3x', 'gray-3x', 'green-channel-3x', 'minimum-channel-3x'], interactionOnly: false },
  { stage: 'contrast', candidateIds: ['gray-3x', 'stretch-3x', 'local-contrast-3x'], interactionOnly: false },
  { stage: 'threshold', candidateIds: ['gray-3x', 'global-160-3x', 'global-176-3x', 'global-192-3x', 'adaptive-3x'], interactionOnly: false },
  { stage: 'sharpening', candidateIds: ['adaptive-3x', 'adaptive-sharpen-mild-3x', 'adaptive-sharpen-moderate-3x'], interactionOnly: false },
  { stage: 'denoising', candidateIds: ['adaptive-3x', 'adaptive-denoise-3x'], interactionOnly: false },
  { stage: 'targeted-interaction', candidateIds: ['threshold-psm', 'grayscale-threshold', 'scale-sharpening'], interactionOnly: true },
];

export function validatePowerScribeFixtureCoverage(
  fixtures: PowerScribeBenchmarkFixtureManifest[],
): string[] {
  const states = new Set(fixtures.flatMap((fixture) => fixture.metadata.interfaceStates));
  const failures: string[] = [];
  if (!states.has('normal')) failures.push('Missing a normal unselected-row fixture.');
  if (!states.has('selected')) failures.push('Missing a selected/highlighted-row fixture.');
  if (!states.has('tan-background') && !states.has('alternating-background')) {
    failures.push('Missing a tan or alternating-background fixture.');
  }
  if (!fixtures.some((fixture) => fixture.metadata.includesPriorityIcons)) failures.push('Missing a priority-icon fixture.');
  if (!fixtures.some((fixture) => fixture.metadata.includesBoundaryAdjacentText)) failures.push('Missing boundary-adjacent text.');
  if (!fixtures.some((fixture) => fixture.metadata.rowCount >= 68)) failures.push('Missing a representative 68-row fixture.');
  if (!fixtures.some((fixture) => fixture.expectedRows.some((row) => row.procedureVisibility?.startsWith('truncated')))) {
    failures.push('Missing a visibly truncated procedure fixture.');
  }
  return failures;
}

export function evaluatePowerScribeBenchmarkBaseline(
  result: PowerScribeBenchmarkVariantResult,
  baseline: PowerScribeBenchmarkBaseline,
): string[] {
  const failures: string[] = [];
  if (result.variantId !== baseline.configurationId) failures.push(`Expected configuration ${baseline.configurationId}, received ${result.variantId}.`);
  if (result.procedure.characterAccuracy < baseline.minimumProcedureCharacterAccuracy) failures.push('Procedure character accuracy regressed.');
  if (result.timestampCharacterAccuracy < baseline.minimumTimestampCharacterAccuracy) failures.push('Timestamp character accuracy regressed.');
  if (result.fullRowAccuracy < baseline.minimumFullRowAccuracy) failures.push('Full-row accuracy regressed.');
  if (baseline.maximumMedianTotalMs != null && result.medianTotalMs > baseline.maximumMedianTotalMs) failures.push('Median full-capture time exceeded its budget.');
  return failures;
}

/**
 * Development-only browser benchmark. Screenshot pixels remain in memory and
 * one persistent OCR worker is reused for every recognition in the run.
 */
export async function runPowerScribeOcrBenchmark(
  input: PowerScribeBenchmarkInput,
): Promise<PowerScribeBenchmarkVariantResult[]> {
  if (!import.meta.env.DEV) throw new Error('The PowerScribe OCR benchmark is available only in a local development build.');
  if (input.expectedRows.length !== input.rows.length) {
    throw new Error(`Expected ${input.rows.length} verified rows, received ${input.expectedRows.length}.`);
  }
  if (input.fixtureMetadata && input.fixtureMetadata.rowCount !== input.rows.length) {
    throw new Error(`Fixture metadata declares ${input.fixtureMetadata.rowCount} rows but geometry contains ${input.rows.length}.`);
  }
  const engine = input.engine ?? getDefaultOcrEngine({} as typeof globalThis);
  const workerStartedAt = performance.now();
  await engine.prepare?.();
  const workerInitializationMs = performance.now() - workerStartedAt;
  const configurations = input.configurations ?? initialPowerScribeBenchmarkConfigurations();
  const repetitions = Math.max(1, Math.min(9, Math.round(input.repetitions ?? 1)));
  const performanceBudgetMs = input.performanceBudgetMs ?? POWERSCRIBE_FULL_CAPTURE_PERFORMANCE_BUDGET_MS;
  const results: PowerScribeBenchmarkVariantResult[] = [];

  for (const combined of configurations) {
    const totals: number[] = [];
    let finalResult: PowerScribeBenchmarkVariantResult | null = null;
    for (let repetition = 0; repetition < repetitions; repetition++) {
      const heapBefore = usedHeapBytes();
      const startedAt = performance.now();
      const preprocessed = await preprocessPowerScribeColumnsForOcr(input.image, {
        manualColumns: input.columns,
        manualRows: input.rows,
        preprocessingConfig: { ...combined.preprocessing },
      });
      const recognized = combined.ocr.recognitionLayout === 'individual-cells'
        ? await recognizeIndividualCells(preprocessed, engine, combined.ocr)
        : await recognizeStackedColumns(preprocessed, engine, combined.ocr);
      const procedure = scoreField(input.expectedRows, recognized.actualRows, 'procedure');
      const examDate = scoreField(input.expectedRows, recognized.actualRows, 'examDate');
      const modifiedDate = scoreField(input.expectedRows, recognized.actualRows, 'modifiedDate');
      const exactRows = input.expectedRows.filter((expected, index) => {
        const actual = recognized.actualRows[index];
        return actual != null && COLUMNS.every((field) =>
          normalizePowerScribeBenchmarkText(expected[field]) === normalizePowerScribeBenchmarkText(actual[field]));
      }).length;
      const resolutionStartedAt = performance.now();
      let resolutionMatches = 0;
      let resolutionTotal = 0;
      let resolutionReviewCount = 0;
      const resolutionResults: PowerScribeBenchmarkResolutionResult[] = [];
      if (input.resolveWithInstitutionVocabulary) {
        for (let index = 0; index < recognized.actualRows.length; index++) {
          const expectedResolved = input.expectedRows[index]?.expectedResolvedProcedure;
          if (!expectedResolved) continue;
          const resolved = await input.resolveWithInstitutionVocabulary(recognized.actualRows[index].procedure);
          resolutionTotal++;
          if (resolved.requiresReview) resolutionReviewCount++;
          const exact = normalizePowerScribeBenchmarkText(resolved.resolvedProcedure ?? '') === normalizePowerScribeBenchmarkText(expectedResolved);
          if (exact) {
            resolutionMatches++;
          }
          resolutionResults.push({
            rowIndex: index,
            visibleOcrText: recognized.actualRows[index].procedure,
            expectedResolvedProcedure: expectedResolved,
            exact,
            ...resolved,
          });
        }
      }
      const normalizationResolutionMs = performance.now() - resolutionStartedAt;
      const totalMs = performance.now() - startedAt;
      totals.push(totalMs);
      const heapAfter = usedHeapBytes();
      finalResult = {
        variantId: combined.id,
        stage: combined.stage,
        configuration: combined.preprocessing,
        ocrConfiguration: combined.ocr,
        procedure,
        examDate,
        modifiedDate,
        timestampCharacterAccuracy: (examDate.characterAccuracy + modifiedDate.characterAccuracy) / 2,
        exactRows,
        totalRows: input.expectedRows.length,
        fullRowAccuracy: input.expectedRows.length ? exactRows / input.expectedRows.length : 0,
        resolutionAccuracy: resolutionTotal ? resolutionMatches / resolutionTotal : null,
        resolutionReviewCount,
        resolutionResults,
        decodeMs: preprocessed.accounting.decodeDurationMs,
        cropSplitMs: preprocessed.accounting.cropSplitDurationMs,
        preprocessingMs: preprocessed.accounting.preprocessingDurationMs,
        workerInitializationMs,
        ocrMs: recognized.durationMs,
        normalizationResolutionMs,
        totalMs,
        coldTotalMs: totalMs + workerInitializationMs,
        medianTotalMs: totalMs,
        perCellOcrMs: recognized.durationMs / Math.max(1, input.expectedRows.length * COLUMNS.length),
        memoryDeltaBytes: heapBefore == null || heapAfter == null ? null : heapAfter - heapBefore,
        withinPerformanceBudget: totalMs <= performanceBudgetMs,
        actualRows: recognized.actualRows,
      };
    }
    if (finalResult) results.push({
      ...finalResult,
      medianTotalMs: median(totals),
      withinPerformanceBudget: median(totals) <= performanceBudgetMs,
    });
  }
  return results;
}

export function rankPowerScribeBenchmarkResults(
  results: PowerScribeBenchmarkVariantResult[],
): PowerScribeBenchmarkVariantResult[] {
  return [...results].sort((left, right) =>
    right.fullRowAccuracy - left.fullRowAccuracy ||
    ((right.procedure.characterAccuracy + right.timestampCharacterAccuracy) -
      (left.procedure.characterAccuracy + left.timestampCharacterAccuracy)) ||
    left.medianTotalMs - right.medianTotalMs,
  );
}

export function productionPowerScribeBenchmarkConfiguration(): PowerScribeCombinedBenchmarkConfiguration {
  return config(POWERSCRIBE_PRODUCTION_PREPROCESSING, POWERSCRIBE_PRODUCTION_OCR_CONFIGURATION, 'engine-baseline');
}
