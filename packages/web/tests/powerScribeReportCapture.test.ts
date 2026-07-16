import { describe, expect, test } from 'bun:test';
import { classifyPowerScribeCaptureKind, inspectPowerScribeReportCapture, POWERSCRIBE_REPORT_HEADER_REGION } from '../src/web/services/captureClassifierService';
import { ReportCaptureImportProvider } from '../src/web/providers/ReportCaptureImportProvider';
import { parsePowerScribeReportHeader } from '../src/web/utils/powerScribeReportHeader';
import type { OcrEngine } from '../src/web/utils/ocrProvider';

describe('PowerScribe report header parser', () => {
  test.each([
    ['EXAMINATION: CT CHEST W CONTRAST, 7/16/2026 8:47 AM CDT', 'CT CHEST W CONTRAST', '2026-07-16T08:47:00', 'CDT'],
    ['EXAMINATION; MRI CERVICAL SPINE WITHOUT AND WITH CONTRAST, 7/6/2026 1:07 PM EDT', 'MRI CERVICAL SPINE WITHOUT AND WITH CONTRAST', '2026-07-06T13:07:00', 'EDT'],
    ['EXAMINATI0N | CT CHEST, ABDOMEN AND PELVIS W CONTRAST, 11/2/2026 12.05 PM CST', 'CT CHEST, ABDOMEN AND PELVIS W CONTRAST', '2026-11-02T12:05:00', 'CST'],
  ])('parses known header variants', (raw, title, dateTime, zone) => {
    expect(parsePowerScribeReportHeader(raw)).toMatchObject({
      matched: true,
      examTitleRaw: title,
      examDateTime: dateTime,
      timeZone: zone,
      needsReview: false,
    });
  });

  test('preserves a readable procedure but never invents a malformed datetime', () => {
    expect(parsePowerScribeReportHeader('EXAMINATION: CT CHEST W CONTRAST, 13/40/2026 8:77 AM CDT')).toMatchObject({
      matched: true,
      examTitleRaw: 'CT CHEST W CONTRAST',
      examDateTime: null,
      needsReview: true,
    });
  });

  test('marks visibly truncated titles for review', () => {
    expect(parsePowerScribeReportHeader('EXAMINATION: MRI BRAIN WITHOUT AND..., 7/16/2026 8:47 AM CDT')).toMatchObject({
      matched: true,
      needsReview: true,
    });
  });
});

describe('report classifier privacy boundary', () => {
  test('routes report, worklist, and unsupported screenshots without guessing', () => {
    expect(classifyPowerScribeCaptureKind(true, false)).toBe('report');
    expect(classifyPowerScribeCaptureKind(false, true)).toBe('worklist');
    expect(classifyPowerScribeCaptureKind(false, false)).toBe('unknown');
  });
  test('crops first and sends only the header Blob to local OCR', async () => {
    const full = new Blob(['full report body PHI'], { type: 'image/png' });
    const headerBlob = new Blob(['header only'], { type: 'image/png' });
    let croppedSource: Blob | null = null;
    let croppedRect: unknown = null;
    let ocrInput: Blob | null = null;
    const engine: OcrEngine = {
      name: 'tesseract.js',
      async extractText(input) {
        ocrInput = input;
        return {
          rawText: 'EXAMINATION: CT CHEST W CONTRAST, 7/16/2026 8:47 AM CDT',
          lines: [], positionedLines: [], positionedWords: [], confidence: 0.98,
        };
      },
    };
    const result = await inspectPowerScribeReportCapture(full, engine, async (source, rect) => {
      croppedSource = source;
      croppedRect = rect;
      return headerBlob;
    });
    expect(croppedSource).toBe(full);
    expect(croppedRect).toEqual(POWERSCRIBE_REPORT_HEADER_REGION);
    expect(ocrInput).toBe(headerBlob);
    expect(ocrInput).not.toBe(full);
    expect(result.detected).toBe(true);
  });

  test('provider emits shared normalized metadata and never accepts an image', async () => {
    const header = parsePowerScribeReportHeader('EXAMINATION: CT CHEST W CONTRAST, 7/16/2026 8:47 AM CDT');
    const studies = await new ReportCaptureImportProvider(header, {
      profileId: 'profile-a', siteId: 'site-a', ocrConfidence: 0.97, captureTimestamp: '2026-07-16T09:00:00.000Z',
    }).importStudies();
    expect(studies[0]).toMatchObject({
      source: 'report_capture', procedureName: 'CT CHEST W CONTRAST', examDateTime: '2026-07-16T08:47:00',
      examTimeZone: 'CDT', captureProfileId: 'profile-a', captureSiteId: 'site-a', ocrConfidence: 0.97,
    });
    expect(JSON.stringify(studies[0])).not.toContain('image');
  });
});
