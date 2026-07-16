import { PSM } from 'tesseract.js';
import { cropImageBlob, type RelativeCropRect } from '../utils/imageCrop';
import { getDefaultOcrEngine, type OcrEngine } from '../utils/ocrProvider';
import { parsePowerScribeReportHeader, type ParsedPowerScribeReportHeader } from '../utils/powerScribeReportHeader';

export const POWERSCRIBE_REPORT_HEADER_REGION: RelativeCropRect = {
  x: 0.04,
  y: 0.04,
  width: 0.92,
  height: 0.32,
};

export interface ReportCaptureInspection {
  detected: boolean;
  headerRect: RelativeCropRect;
  header: ParsedPowerScribeReportHeader;
  ocrConfidence: number;
}

export function classifyPowerScribeCaptureKind(
  reportDetected: boolean,
  worklistDetected: boolean,
): 'report' | 'worklist' | 'unknown' {
  if (reportDetected) return 'report';
  if (worklistDetected) return 'worklist';
  return 'unknown';
}

/**
 * Privacy boundary: only this small header crop is handed to OCR. The source
 * Blob is never stored, logged, or passed to persistence/cloud services.
 */
export async function inspectPowerScribeReportCapture(
  source: Blob,
  engine: OcrEngine = getDefaultOcrEngine(),
  crop: (source: Blob, rect: RelativeCropRect) => Promise<Blob> = cropImageBlob,
  headerRect: RelativeCropRect = POWERSCRIBE_REPORT_HEADER_REGION,
): Promise<ReportCaptureInspection> {
  const headerBlob = await crop(source, headerRect);
  const result = await engine.extractText(headerBlob, {
    pageSegMode: PSM.SINGLE_BLOCK,
    preserveInterwordSpaces: true,
    dictionaryCorrection: false,
    userDefinedDpi: 300,
  });
  const header = parsePowerScribeReportHeader(result.rawText);
  return {
    detected: header.matched,
    headerRect,
    header,
    ocrConfidence: result.confidence,
  };
}
