import type { RelativeCropRect } from './imageCrop';

export interface PowerScribeOcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

export interface HeaderAnchorLayout {
  tableRect: RelativeCropRect;
  columns: {
    procedure: RelativeCropRect;
    examDate: RelativeCropRect;
    modifiedDate: RelativeCropRect;
  };
  bandPitch: number | null;
  modifiedAnchorCount: number;
}

export type PowerScribeStructuralLayout = HeaderAnchorLayout;

function normalizedText(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function centerY(word: PowerScribeOcrWord): number {
  return (word.bbox.y0 + word.bbox.y1) / 2;
}

function isProcedureStartWord(word: PowerScribeOcrWord): boolean {
  return /^(?:CTA?|MRI?|MRA|XR|US|NM|PET|MAMMO|FL|IR)/.test(normalizedText(word.text));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function findHeaderWord(words: PowerScribeOcrWord[], name: string): PowerScribeOcrWord | null {
  return words.find((word) => normalizedText(word.text) === name) ?? null;
}

function findExamDateHeader(words: PowerScribeOcrWord[]): PowerScribeOcrWord | null {
  const combined = findHeaderWord(words, 'EXAMDATE');
  if (combined) return combined;
  const exam = findHeaderWord(words, 'EXAM');
  if (!exam) return null;
  const examHeight = Math.max(1, exam.bbox.y1 - exam.bbox.y0);
  const date = words.find((word) =>
    normalizedText(word.text) === 'DATE' &&
    word.bbox.x0 >= exam.bbox.x1 &&
    Math.abs(centerY(word) - centerY(exam)) <= examHeight,
  );
  if (!date) return null;
  return {
    text: 'Exam Date',
    confidence: Math.min(exam.confidence, date.confidence),
    bbox: {
      x0: exam.bbox.x0,
      y0: Math.min(exam.bbox.y0, date.bbox.y0),
      x1: date.bbox.x1,
      y1: Math.max(exam.bbox.y1, date.bbox.y1),
    },
  };
}

function modifiedDateBands(words: PowerScribeOcrWord[], modified: PowerScribeOcrWord): Array<{ y0: number; y1: number }> {
  const candidates = words
    .filter((word) => word.bbox.y0 > modified.bbox.y1 && word.bbox.x1 >= modified.bbox.x0)
    .filter((word) => /\d/.test(word.text) && /[/:]/.test(word.text))
    .sort((a, b) => centerY(a) - centerY(b));
  const bands: Array<{ y0: number; y1: number }> = [];
  for (const word of candidates) {
    const height = Math.max(1, word.bbox.y1 - word.bbox.y0);
    const existing = bands.find((band) => Math.abs((band.y0 + band.y1) / 2 - centerY(word)) <= height);
    if (existing) {
      existing.y0 = Math.min(existing.y0, word.bbox.y0);
      existing.y1 = Math.max(existing.y1, word.bbox.y1);
    } else {
      bands.push({ y0: word.bbox.y0, y1: word.bbox.y1 });
    }
  }
  return bands;
}

export function detectPowerScribeHeaderLayout(
  words: PowerScribeOcrWord[],
  imageWidth: number,
  imageHeight: number,
): HeaderAnchorLayout | null {
  if (imageWidth <= 0 || imageHeight <= 0) return null;
  const procedure = findHeaderWord(words, 'PROCEDURE');
  const examDate = findExamDateHeader(words);
  const modified = findHeaderWord(words, 'MODIFIED');
  if (!procedure || !examDate || !modified) return null;
  const headerHeight = Math.max(1, modified.bbox.y1 - modified.bbox.y0);
  const sameRow = Math.max(centerY(procedure), centerY(examDate), centerY(modified)) -
    Math.min(centerY(procedure), centerY(examDate), centerY(modified)) <= headerHeight * 1.5;
  if (!sameRow || !(procedure.bbox.x0 < examDate.bbox.x0 && examDate.bbox.x0 < modified.bbox.x0)) return null;

  const bands = modifiedDateBands(words, modified);
  if (!bands.length) return null;
  const centers = bands.map((band) => (band.y0 + band.y1) / 2);
  const bandPitch = median(centers.slice(1).map((center, index) => center - centers[index]).filter((pitch) => pitch > headerHeight));
  const bottomPx = Math.min(imageHeight * 0.98, bands[bands.length - 1].y1 + (bandPitch ?? headerHeight * 1.8));
  const topPx = Math.min(imageHeight, Math.max(procedure.bbox.y1, examDate.bbox.y1, modified.bbox.y1) + headerHeight * 0.2);
  const leftPx = Math.max(0, procedure.bbox.x0 - imageWidth * 0.006);
  const rightPx = Math.min(imageWidth * 0.99, modified.bbox.x1 + Math.max(imageWidth * 0.12, (modified.bbox.x1 - modified.bbox.x0) * 1.8));
  if (rightPx - leftPx < imageWidth * 0.35 || bottomPx - topPx < imageHeight * 0.15) return null;

  const tableRect = {
    x: leftPx / imageWidth,
    y: topPx / imageHeight,
    width: (rightPx - leftPx) / imageWidth,
    height: (bottomPx - topPx) / imageHeight,
  };
  const relativeX = (absoluteX: number) => (absoluteX / imageWidth - tableRect.x) / tableRect.width;
  const procedureX = Math.max(0, relativeX(procedure.bbox.x0));
  const examX = Math.max(procedureX + 0.1, relativeX(examDate.bbox.x0));
  const modifiedX = Math.max(examX + 0.08, relativeX(modified.bbox.x0));
  const firstBoundary = (examX + Math.min(1, relativeX(procedure.bbox.x1))) / 2;
  const secondBoundary = (modifiedX + Math.min(1, relativeX(examDate.bbox.x1))) / 2;

  return {
    tableRect,
    columns: {
      procedure: { x: procedureX, y: 0, width: Math.max(0.05, firstBoundary - procedureX), height: 1 },
      examDate: { x: examX, y: 0, width: Math.max(0.05, secondBoundary - examX), height: 1 },
      modifiedDate: { x: modifiedX, y: 0, width: Math.max(0.05, 1 - modifiedX), height: 1 },
    },
    bandPitch,
    modifiedAnchorCount: bands.length,
  };
}

function groupDateWordsByX(words: PowerScribeOcrWord[]): [PowerScribeOcrWord[], PowerScribeOcrWord[]] | null {
  if (words.length < 4) return null;
  const sorted = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
  let splitIndex = -1;
  let largestGap = 0;
  for (let index = 1; index < sorted.length; index++) {
    const gap = sorted[index].bbox.x0 - sorted[index - 1].bbox.x0;
    if (gap > largestGap) {
      largestGap = gap;
      splitIndex = index;
    }
  }
  if (splitIndex < 2 || sorted.length - splitIndex < 2 || largestGap < 40) return null;
  return [sorted.slice(0, splitIndex), sorted.slice(splitIndex)];
}

export function detectPowerScribeDatetimeLayout(
  words: PowerScribeOcrWord[],
  imageWidth: number,
  imageHeight: number,
): PowerScribeStructuralLayout | null {
  const dateWords = words.filter((word) => /^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}$/.test(word.text.trim()));
  const groups = groupDateWordsByX(dateWords);
  if (!groups) return null;
  const [examWords, modifiedWords] = groups;
  const examX = median(examWords.map((word) => word.bbox.x0));
  const modifiedX = median(modifiedWords.map((word) => word.bbox.x0));
  if (examX == null || modifiedX == null || modifiedX - examX < imageWidth * 0.08) return null;

  const modifiedBands = modifiedWords
    .map((word) => ({ y0: word.bbox.y0, y1: word.bbox.y1 }))
    .sort((a, b) => a.y0 - b.y0);
  const centers = modifiedBands.map((band) => (band.y0 + band.y1) / 2);
  const bandPitch = median(centers.slice(1).map((center, index) => center - centers[index]).filter((pitch) => pitch > 4));
  const medianHeight = median(modifiedBands.map((band) => band.y1 - band.y0)) ?? 18;
  const topPx = Math.max(0, Math.min(...modifiedBands.map((band) => band.y0)) - (bandPitch ?? medianHeight * 1.8) * 0.7);
  const bottomPx = Math.min(imageHeight, Math.max(...modifiedBands.map((band) => band.y1)) + (bandPitch ?? medianHeight * 1.8));
  const rowWords = words.filter((word) => centerY(word) >= topPx && centerY(word) <= bottomPx && word.bbox.x0 < examX);
  const procedureStarts = rowWords.filter(isProcedureStartWord);
  const inferredProcedureWidth = Math.min(
    imageWidth * 0.34,
    Math.max(imageWidth * 0.18, (modifiedX - examX) * 3.2),
  );
  const leftPx = procedureStarts.length > 0
    ? Math.max(0, Math.min(...procedureStarts.map((word) => word.bbox.x0)) - imageWidth * 0.006)
    : Math.max(0, examX - inferredProcedureWidth);
  const modifiedRowWords = words
    .filter((word) => centerY(word) >= topPx && centerY(word) <= bottomPx && word.bbox.x0 >= modifiedX);
  const modifiedRight = modifiedRowWords.length > 0
    ? Math.max(...modifiedRowWords.map((word) => word.bbox.x1))
    : modifiedX + imageWidth * 0.12;
  const rightPx = Math.min(imageWidth, modifiedRight + imageWidth * 0.015);
  if (bottomPx - topPx < imageHeight * 0.1 || rightPx - leftPx < imageWidth * 0.3) return null;

  const tableRect = {
    x: leftPx / imageWidth,
    y: topPx / imageHeight,
    width: (rightPx - leftPx) / imageWidth,
    height: (bottomPx - topPx) / imageHeight,
  };
  const relativeExamX = (examX - leftPx) / (rightPx - leftPx);
  const relativeModifiedX = (modifiedX - leftPx) / (rightPx - leftPx);
  const firstBoundary = Math.max(0.1, relativeExamX - 0.012);
  const secondBoundary = Math.max(firstBoundary + 0.08, relativeModifiedX - 0.012);
  return {
    tableRect,
    columns: {
      procedure: { x: 0, y: 0, width: firstBoundary, height: 1 },
      examDate: { x: Math.min(0.9, relativeExamX), y: 0, width: Math.max(0.05, secondBoundary - relativeExamX), height: 1 },
      modifiedDate: { x: Math.min(0.94, relativeModifiedX), y: 0, width: Math.max(0.05, 1 - relativeModifiedX), height: 1 },
    },
    bandPitch,
    modifiedAnchorCount: modifiedBands.length,
  };
}
