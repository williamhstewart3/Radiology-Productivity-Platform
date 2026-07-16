import { describe, expect, test } from 'bun:test';
import {
  POWERSCRIBE_PREPROCESSING_BENCHMARK_VARIANTS,
  POWERSCRIBE_PRODUCTION_PREPROCESSING,
  preprocessPowerScribeRgba,
  resolvePowerScribePreprocessScale,
  type PowerScribePreprocessConfig,
} from '../src/web/utils/powerScribePreprocessing';
import {
  POWERSCRIBE_STAGED_SEARCH,
  evaluatePowerScribeBenchmarkBaseline,
  initialPowerScribeBenchmarkConfigurations,
  normalizePowerScribeBenchmarkText,
  powerScribeCharacterAccuracy,
  rankPowerScribeBenchmarkResults,
  validatePowerScribeFixtureCoverage,
  type PowerScribeBenchmarkVariantResult,
} from '../src/web/utils/powerScribeOcrBenchmark';
import {
  POWERSCRIBE_OCR_ENGINE_BASELINE_VARIANTS,
  POWERSCRIBE_PRODUCTION_OCR_CONFIGURATION,
  powerScribeOcrParamsForColumn,
} from '../src/web/utils/powerScribeOcrConfiguration';
import {
  POWERSCRIBE_CHARACTER_REGRESSION_CASES,
  POWERSCRIBE_REPEATED_STUDY_ROWS,
} from './fixtures/powerScribePreprocessingCases';

function config(patch: Partial<PowerScribePreprocessConfig> = {}): PowerScribePreprocessConfig {
  return {
    ...POWERSCRIBE_PRODUCTION_PREPROCESSING,
    scaleFactor: 3,
    contrastMode: 'none',
    contrast: 1,
    thresholdMode: 'none',
    denoiseStrength: 0,
    sharpeningStrength: 0,
    ...patch,
  };
}

function rgba(values: Array<[number, number, number]>): Uint8ClampedArray {
  return Uint8ClampedArray.from(values.flatMap(([red, green, blue]) => [red, green, blue, 255]));
}

describe('PowerScribe OCR preprocessing', () => {
  test('converts source pixels to grayscale without destroying luminance distinctions', () => {
    const result = preprocessPowerScribeRgba({
      data: rgba([[255, 0, 0], [0, 255, 0], [0, 0, 255]]),
      width: 3,
      height: 1,
    }, config());
    const pixels = [result.data[0], result.data[4], result.data[8]];
    expect(pixels[0]).toBeGreaterThan(pixels[2]);
    expect(pixels[1]).toBeGreaterThan(pixels[0]);
    expect(result.data[0]).toBe(result.data[1]);
    expect(result.data[1]).toBe(result.data[2]);
  });

  test('keeps grayscale, global binary, and adaptive threshold variants observably distinct', () => {
    const input = {
      data: rgba([
        [40, 40, 40], [120, 120, 120], [230, 230, 230],
        [55, 55, 55], [135, 135, 135], [245, 245, 245],
        [70, 70, 70], [150, 150, 150], [255, 255, 255],
      ]),
      width: 3,
      height: 3,
    };
    const gray = preprocessPowerScribeRgba(input, config());
    const global = preprocessPowerScribeRgba(input, config({ thresholdMode: 'global', thresholdValue: 140 }));
    const adaptive = preprocessPowerScribeRgba(input, config({ thresholdMode: 'adaptive', adaptiveRadius: 1, adaptiveBias: -20 }));

    expect(new Set(gray.data.filter((_, index) => index % 4 === 0)).size).toBeGreaterThan(2);
    expect([...global.data].every((value, index) => index % 4 === 3 || value === 0 || value === 255)).toBe(true);
    expect([...adaptive.data]).not.toEqual([...global.data]);
  });

  test('benchmarks ClearType-aware channels and preserves original RGB when requested', () => {
    const input = { data: rgba([[200, 100, 50]]), width: 1, height: 1 };
    const luminance = preprocessPowerScribeRgba(input, config({ grayscaleMethod: 'luminance' }));
    const green = preprocessPowerScribeRgba(input, config({ grayscaleMethod: 'green-channel' }));
    const minimum = preprocessPowerScribeRgba(input, config({ grayscaleMethod: 'minimum-channel' }));
    const original = preprocessPowerScribeRgba(input, config({ grayscaleMethod: 'original-rgb' }));
    expect(luminance.data[0]).toBe(124);
    expect(green.data[0]).toBe(100);
    expect(minimum.data[0]).toBe(50);
    expect([...original.data]).toEqual([200, 100, 50, 255]);
  });

  test('includes 1x through 4x plus denoise and sharpening comparisons', () => {
    const ids = POWERSCRIBE_PREPROCESSING_BENCHMARK_VARIANTS.map((variant) => variant.id);
    expect(ids).toEqual(expect.arrayContaining(['gray-1x', 'gray-2x', 'gray-3x', 'gray-4x']));
    expect(ids.some((id) => id.includes('denoise'))).toBe(true);
    expect(ids.some((id) => id.includes('sharpen-mild'))).toBe(true);
    expect(ids.some((id) => id.includes('sharpen-moderate'))).toBe(true);
    expect(ids.some((id) => id.includes('global'))).toBe(true);
    expect(ids.some((id) => id.includes('adaptive'))).toBe(true);
    expect(ids).toEqual(expect.arrayContaining(['rgb-3x', 'green-channel-3x', 'minimum-channel-3x']));
  });

  test('centralizes and bounds automatic scale selection', () => {
    expect(resolvePowerScribePreprocessScale(POWERSCRIBE_PRODUCTION_PREPROCESSING, null)).toBe(3);
    expect(resolvePowerScribePreprocessScale(POWERSCRIBE_PRODUCTION_PREPROCESSING, 2)).toBe(4);
    expect(resolvePowerScribePreprocessScale(POWERSCRIBE_PRODUCTION_PREPROCESSING, 100)).toBe(1.5);
    expect(resolvePowerScribePreprocessScale(config({ scaleFactor: 2 }), 100)).toBe(2);
  });
});

describe('PowerScribe OCR benchmark scoring', () => {
  test('stages engine, scale, grayscale, and image treatments without a full-grid explosion', () => {
    expect(POWERSCRIBE_STAGED_SEARCH.map((stage) => stage.stage)).toEqual([
      'engine-baseline', 'scale', 'grayscale', 'contrast', 'threshold', 'sharpening', 'denoising', 'targeted-interaction',
    ]);
    expect(initialPowerScribeBenchmarkConfigurations()).toHaveLength(POWERSCRIBE_OCR_ENGINE_BASELINE_VARIANTS.length);
    expect(initialPowerScribeBenchmarkConfigurations().every((item) => item.preprocessing.id === 'gray-3x')).toBe(true);
  });

  test('combines PSM, whitelist, dictionary, and DPI settings with field-specific alphabets', () => {
    const ids = POWERSCRIBE_OCR_ENGINE_BASELINE_VARIANTS.map((variant) => variant.id);
    expect(ids.some((id) => id.includes('single-line'))).toBe(true);
    expect(ids.some((id) => id.includes('single-word'))).toBe(true);
    expect(ids.some((id) => id.includes('no-whitelist'))).toBe(true);
    expect(ids.some((id) => id.endsWith('-dict'))).toBe(true);
    expect(ids.some((id) => id.includes('dpi200'))).toBe(true);
    expect(ids.some((id) => id.includes('dpi400'))).toBe(true);
    expect(powerScribeOcrParamsForColumn('procedure').charWhitelist).toContain('…');
    expect(powerScribeOcrParamsForColumn('examDate').charWhitelist).toBe('0123456789/: APM');
    expect(POWERSCRIBE_PRODUCTION_OCR_CONFIGURATION.recognitionLayout).toBe('stacked-columns');
  });
  test('scores exact text, OCR substitutions, missing punctuation, and whitespace deterministically', () => {
    expect(normalizePowerScribeBenchmarkText('  xr  chest portable ')).toBe('XR CHEST PORTABLE');
    expect(powerScribeCharacterAccuracy('OBLIQUE', 'OBLIGUE')).toBeCloseTo(6 / 7);
    expect(powerScribeCharacterAccuracy('7/16/26 8:15 AM', '7/16/26 815 AM')).toBeLessThan(1);
    expect(powerScribeCharacterAccuracy('MRI CERVICAL SPINE', 'MRI CERVICAL SPINE')).toBe(1);
  });

  test('keeps every known character-confusion fixture measurable instead of silently normalizing it away', () => {
    for (const fixture of POWERSCRIBE_CHARACTER_REGRESSION_CASES) {
      const accuracy = powerScribeCharacterAccuracy(fixture.expected, fixture.plausibleOcrFailure);
      expect(accuracy, fixture.name).toBeGreaterThan(0);
      expect(accuracy, fixture.name).toBeLessThan(1);
    }
  });

  test('keeps repeated same-title studies with different timestamps as separate benchmark truth rows', () => {
    expect(POWERSCRIBE_REPEATED_STUDY_ROWS).toHaveLength(2);
    expect(POWERSCRIBE_REPEATED_STUDY_ROWS[0].procedure).toBe(POWERSCRIBE_REPEATED_STUDY_ROWS[1].procedure);
    expect(POWERSCRIBE_REPEATED_STUDY_ROWS[0].examDate).not.toBe(POWERSCRIBE_REPEATED_STUDY_ROWS[1].examDate);
    expect(POWERSCRIBE_REPEATED_STUDY_ROWS[0].modifiedDate).not.toBe(POWERSCRIBE_REPEATED_STUDY_ROWS[1].modifiedDate);
  });

  test('ranks exact-row accuracy first and processing time only as the tie-breaker', () => {
    const base = {
      stage: 'engine-baseline' as const,
      configuration: config(),
      ocrConfiguration: POWERSCRIBE_PRODUCTION_OCR_CONFIGURATION,
      procedure: { characterAccuracy: 1, exactCells: 1, totalCells: 1 },
      examDate: { characterAccuracy: 1, exactCells: 1, totalCells: 1 },
      modifiedDate: { characterAccuracy: 1, exactCells: 1, totalCells: 1 },
      timestampCharacterAccuracy: 1,
      exactRows: 1,
      totalRows: 1,
      fullRowAccuracy: 1,
      resolutionAccuracy: null,
      resolutionReviewCount: 0,
      resolutionResults: [],
      decodeMs: 1,
      cropSplitMs: 1,
      preprocessingMs: 1,
      workerInitializationMs: 1,
      ocrMs: 1,
      normalizationResolutionMs: 1,
      coldTotalMs: 2,
      medianTotalMs: 1,
      perCellOcrMs: 1,
      memoryDeltaBytes: null,
      withinPerformanceBudget: true,
      actualRows: [],
    } satisfies Omit<PowerScribeBenchmarkVariantResult, 'variantId' | 'totalMs'>;
    const ranked = rankPowerScribeBenchmarkResults([
      { ...base, variantId: 'slow', totalMs: 20, medianTotalMs: 20 },
      { ...base, variantId: 'fast', totalMs: 10, medianTotalMs: 10 },
      { ...base, variantId: 'inexact', fullRowAccuracy: 0, exactRows: 0, totalMs: 1, medianTotalMs: 1 },
    ]);
    expect(ranked.map((result) => result.variantId)).toEqual(['fast', 'slow', 'inexact']);

    expect(evaluatePowerScribeBenchmarkBaseline(ranked[0], {
      fixtureId: 'fixture',
      configurationId: 'fast',
      minimumProcedureCharacterAccuracy: 1,
      minimumTimestampCharacterAccuracy: 1,
      minimumFullRowAccuracy: 1,
      maximumMedianTotalMs: 30,
    })).toEqual([]);
  });

  test('requires permanent fixture coverage for selected rows, icons, boundaries, 68 rows, and truncation', () => {
    expect(validatePowerScribeFixtureCoverage([])).toHaveLength(7);
    expect(validatePowerScribeFixtureCoverage([{
      sourceImagePath: 'deidentified/full-capture.png',
      columns: {
        procedure: { x: 0, y: 0, width: 0.5, height: 1 },
        examDate: { x: 0.5, y: 0, width: 0.25, height: 1 },
        modifiedDate: { x: 0.75, y: 0, width: 0.25, height: 1 },
      },
      rows: [],
      expectedRows: [{
        procedure: 'MRI CERVICAL SPINE W…',
        examDate: '7/16/26 8:15 AM',
        modifiedDate: '7/16/26 8:42 AM',
        procedureVisibility: 'truncated-with-ellipsis',
      }],
      metadata: {
        id: 'full-capture',
        description: 'deidentified fixture',
        rowCount: 68,
        interfaceStates: ['normal', 'selected', 'tan-background', 'alternating-background'],
        includesPriorityIcons: true,
        includesBoundaryAdjacentText: true,
      },
    }])).toEqual([]);
  });
});
