import { describe, expect, test } from 'bun:test';
import { db } from '../src/web/db/database';
import { runImportPipeline, commitPipelineResults } from '../src/web/pipeline/importPipeline';
import type { ImportedStudy } from '../src/web/types/importProvider';
import type { CptRvuRow } from '../src/web/types';

function cptRow(): CptRvuRow {
  return {
    id: 'test_71045_chest_portable',
    cptCode: '71045',
    modifier: '26',
    description: 'XR Chest 1 View',
    workRvu: 0.15,
    nonFacilityPeRvu: null,
    facilityPeRvu: null,
    malpracticeRvu: null,
    totalRvuNonFacility: null,
    totalRvuFacility: null,
    statusCode: 'A',
    statusCategory: 'active',
    globalDays: null,
    pcTcIndicator: 'professional',
    modality: 'XR',
    rvuFileVersion: 'TEST',
    effectiveDate: '2026-01-01',
    includeInAutoMatch: true,
    autoMatchSource: 'test active set',
    isUserVerified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

// Deliberately far from the dates used elsewhere in the suite (mostly 2026-07-xx) —
// the fake-indexeddb instance is shared across test files in this process, and
// duplicate detection queries by logDate across the whole table.
const LOG_DATE = '2031-11-03';

// Offset from 01:00, never 00:00 — isoToMinutes(00:00) is 0, and duplicateDetection.ts's
// "no time" fallback checks truthiness (!logMinutes), which is a false positive for
// midnight. Starting an hour in avoids tripping that unrelated pre-existing edge case.
function timestampForMinuteOffset(minuteOffset: number): string {
  const totalMinutes = 60 + minuteOffset;
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${LOG_DATE}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
}

function ocrStudy(minuteOffset: number, options: { missingModified?: boolean } = {}): ImportedStudy {
  const examDateTime = timestampForMinuteOffset(minuteOffset);
  const modifiedDateTime = options.missingModified ? null : examDateTime;
  return {
    examTitle: 'XR CHEST PORTABLE',
    procedureName: 'XR CHEST PORTABLE',
    canonicalExam: null,
    cpt: null,
    workRvu: null,
    studyDate: LOG_DATE,
    examDate: LOG_DATE,
    examTime: examDateTime.slice(11, 16),
    examDateTime,
    studyTime: modifiedDateTime,
    modifiedDate: modifiedDateTime ? LOG_DATE : null,
    modifiedTime: modifiedDateTime ? modifiedDateTime.slice(11, 16) : null,
    modifiedDateTime,
    modality: 'XR',
    accessionNumber: null,
    patientMRN: null,
    rowIndex: null,
    cleanedExamName: 'XR CHEST PORTABLE',
    cleanedText: 'XR CHEST PORTABLE',
    extractionConfidence: 0.95,
    parserNeedsReview: false,
    parserReviewReason: null,
    parserRawLine: `minute-${minuteOffset}`,
    ocrConfidence: 0.95,
    source: 'ocr',
    importedAt: new Date().toISOString(),
    dateTimeConfidence: 1,
    dateTimeSource: 'ocr',
  };
}

async function runCapture(studies: ImportedStudy[]) {
  const pipeline = await runImportPipeline(studies, LOG_DATE, null);
  const commit = await commitPipelineResults(pipeline.reviewRows, LOG_DATE, pipeline.skippedRows.length, null);
  return { pipeline, commit };
}

describe('growing-list simulation — the real-workflow acceptance test', () => {
  test('repeated captures of a growing worklist save only what is new, every time', async () => {
    await db.cptRvuTable.add(cptRow());

    // Every distinct study is spaced >15 minutes apart from every other
    // distinct study, so the CPT+time-proximity "possible" tier (which
    // matches whichever log happens to be checked first, not necessarily
    // the closest one) can never fire between two genuinely different
    // studies — only the exact-fingerprint / secondary-anchor passes can
    // classify a match. True repeats reuse the identical timestamp.

    // ── Capture #1: 20 fresh rows ──────────────────────────────────────────
    const capture1Studies = Array.from({ length: 20 }, (_, i) => ocrStudy(i * 20));
    const capture1 = await runCapture(capture1Studies);
    expect(capture1.pipeline.skippedRows.length).toBe(0);
    expect(capture1.commit.importedCount).toBe(20);
    expect(capture1.commit.alreadySavedCount).toBe(0);

    // ── Capture #2: the same 20 rows + 15 new ones ─────────────────────────
    const capture2NewStudies = Array.from({ length: 15 }, (_, i) => ocrStudy(450 + i * 20));
    const capture2Studies = [...capture1Studies, ...capture2NewStudies];
    const capture2 = await runCapture(capture2Studies);

    expect(capture2.pipeline.skippedRows.length).toBe(20);
    expect(capture2.pipeline.skippedRows.every((row) => row.duplicateStatus === 'exact' && row.autoSkipped)).toBe(true);
    expect(capture2.pipeline.reviewRows.length).toBe(15);
    expect(capture2.commit.importedCount).toBe(15);
    expect(capture2.commit.reviewNeededCount).toBe(0);
    expect(capture2.commit.alreadySavedCount).toBe(0);

    // ── Capture #3: all 35 so far + 10 new, with 2 of the 35 missing Modified time ──
    const allPriorStudies = [...capture1Studies, ...capture2NewStudies];
    const [degradedA, degradedB, ...restPrior] = allPriorStudies;
    const degradedRepeats = [degradedA, degradedB].map((study) => ({ ...study, modifiedDateTime: null, modifiedDate: null, modifiedTime: null }));
    const capture3NewStudies = Array.from({ length: 10 }, (_, i) => ocrStudy(800 + i * 20));
    const capture3Studies = [...restPrior, ...degradedRepeats, ...capture3NewStudies];
    const capture3 = await runCapture(capture3Studies);

    // 33 of the 35 repeats are still full-fidelity exact duplicates.
    expect(capture3.pipeline.skippedRows.length).toBe(33);
    expect(capture3.pipeline.skippedRows.every((row) => row.duplicateStatus === 'exact' && row.autoSkipped)).toBe(true);

    // The 2 Modified-less repeats must land in review as possible duplicates —
    // never silently saved, never auto-skipped.
    const possibleDupeRows = capture3.pipeline.reviewRows.filter((row) => row.duplicateStatus === 'possible');
    expect(possibleDupeRows.length).toBe(2);
    for (const row of possibleDupeRows) {
      expect(row.duplicateReason).toBe('Same exam title and performed time; Modified time missing');
      expect(row.needsReview).toBe(true);
      expect(row.autoApproved).toBe(false);
    }

    // 10 new rows + 2 possible-duplicate rows make up reviewRows; only the
    // 10 new rows are save-eligible without manual intervention.
    expect(capture3.pipeline.reviewRows.length).toBe(12);
    expect(capture3.commit.importedCount).toBe(10);
    expect(capture3.commit.reviewNeededCount).toBe(2);
    expect(capture3.commit.alreadySavedCount).toBe(0);
  });
});
