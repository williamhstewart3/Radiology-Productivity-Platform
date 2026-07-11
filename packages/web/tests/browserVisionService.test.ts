import { describe, expect, test } from 'bun:test';
import {
  extractJsonFromModelText,
  getBrowserVisionModelInfo,
  normalizeBrowserVisionRows,
  salvageBrowserVisionRowsFromText,
} from '../src/web/services/browserVisionService';

describe('browserVisionService structured output handling', () => {
  test('documents the browser-compatible Florence model metadata', () => {
    const info = getBrowserVisionModelInfo();

    expect(info.modelId).toBe('onnx-community/Florence-2-base-ft');
    expect(info.taskType).toBe('image-text-to-text');
    expect(info.webGpuMandatory).toBe(true);
    expect(info.wasmSupportedExplicitly).toBe(true);
  });

  test('recovers JSON wrapped in markdown fences', () => {
    const parsed = extractJsonFromModelText('```json\n{"rows":[{"procedure":"XR CHEST PORTABLE","examDateTime":"7/1/2026 5:18 PM","modifiedDateTime":"7/2/2026 7:59 AM","confidence":0.98}]}\n```');
    const { rows, invalidRowCount } = normalizeBrowserVisionRows(parsed);

    expect(invalidRowCount).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].procedureName).toBe('XR CHEST PORTABLE');
    expect(rows[0].examDateTime).toBe('7/1/2026 5:18 PM');
    expect(rows[0].modifiedDateTime).toBe('7/2/2026 7:59 AM');
    expect(rows[0].needsReview).toBe(false);
  });

  test('retains low-confidence rows and missing datetime rows for review', () => {
    const { rows, invalidRowCount } = normalizeBrowserVisionRows({
      rows: [
        { rowNumber: 1, procedure: 'XR ABDOMEN AP', examDateTime: '7/11/2026 8:28 PM', confidence: 0.42 },
        { rowNumber: 2, procedure: '', examDateTime: '7/11/2026 8:30 PM', modifiedDateTime: '7/11/2026 8:35 PM' },
      ],
    });

    expect(invalidRowCount).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].procedureName).toBe('XR ABDOMEN AP');
    expect(rows[0].modifiedDateTime).toBeNull();
    expect(rows[0].needsReview).toBe(true);
    expect(rows[0].reviewReason).toContain('Modified/Read');
  });

  test('invalid free-form output fails instead of silently falling back', () => {
    expect(() => extractJsonFromModelText('XR CHEST PORTABLE 7/1/2026 5:18 PM')).toThrow(/parseable JSON/);
  });

  test('unanswerable model output is reported as an unsuitable model result', () => {
    expect(() => extractJsonFromModelText('unanswerable')).toThrow(/could not read the PowerScribe table/);
  });

  test('salvages line-oriented table text into review rows without OCR fallback', () => {
    const { rows, invalidRowCount } = salvageBrowserVisionRowsFromText([
      '1 XR CHEST PORTABLE 7/1/2026 5:18 PM 7/2/2026 7:59 AM',
      '2 CT APPENDIX PROTOCOL 7/2/2026 6:51 AM 7/2/2026 8:31 AM',
      'Browse Status Today',
    ].join('\n'));

    expect(invalidRowCount).toBe(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].procedureName).toBe('XR CHEST PORTABLE');
    expect(rows[0].examDateTime).toBe('7/1/2026 5:18 PM');
    expect(rows[0].modifiedDateTime).toBe('7/2/2026 7:59 AM');
    expect(rows[0].needsReview).toBe(true);
    expect(rows[1].procedureName).toBe('CT APPENDIX PROTOCOL');
  });
});
