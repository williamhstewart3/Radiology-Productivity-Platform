import { describe, expect, test } from 'bun:test';
import { PowerScribeVisionImportProvider } from '../src/web/providers/PowerScribeVisionImportProvider';
import { __testDeterministicCptCodesFor } from '../src/web/utils/matching';

describe('PowerScribeVisionImportProvider', () => {
  test('maps Ollama Vision rows to ImportedStudy without CPT or RVU assignment', async () => {
    const provider = new PowerScribeVisionImportProvider([
      {
        procedureName: 'XR CHEST PORTABLE',
        examDateTime: '2026-07-01T17:18',
        modifiedDateTime: '2026-07-02T07:59',
        rawProcedureText: 'XR CHEST PORTABLE',
        rawExamDateText: '7/1/2026 5:18 PM',
        rawModifiedText: '7/2/2026 7:59 AM',
        rowIndex: '1',
        confidence: 0.94,
        needsReview: false,
        reviewReason: null,
      },
    ], '2026-07-09');

    const [study] = await provider.importStudies();

    expect(study.source).toBe('vision');
    expect(study.procedureName).toBe('XR CHEST PORTABLE');
    expect(study.examTitle).toBe('XR CHEST PORTABLE');
    expect(study.cpt).toBeNull();
    expect(study.workRvu).toBeNull();
    expect(study.accessionNumber).toBeNull();
    expect(study.examDateTime).toBe('2026-07-01T17:18:00');
    expect(study.modifiedDateTime).toBe('2026-07-02T07:59:00');
    expect(study.studyTime).toBe('2026-07-02T07:59:00');
    expect(study.studyDate).toBe('2026-07-02');
    expect(study.dateTimeSource).toBe('vision');
    expect(study.parserRawLine).toContain('ollama_vision');
  });

  test('emits procedure text that existing CPT matching can resolve', async () => {
    const provider = new PowerScribeVisionImportProvider([
      {
        procedureName: 'XR CHEST PORTABLE',
        examDateTime: '2026-07-01T17:18',
        modifiedDateTime: '2026-07-02T07:59',
        rawProcedureText: 'XR CHEST PORTABLE',
        rawExamDateText: '7/1/2026 5:18 PM',
        rawModifiedText: '7/2/2026 7:59 AM',
        rowIndex: '1',
        confidence: 0.96,
        needsReview: false,
        reviewReason: null,
      },
    ], '2026-07-09');

    const [study] = await provider.importStudies();
    const cptCodes = __testDeterministicCptCodesFor(study.procedureName ?? study.examTitle);

    expect(cptCodes).toContain('71045');
    expect(study.procedureName).toBe('XR CHEST PORTABLE');
    expect(study.examDateTime).toBe('2026-07-01T17:18:00');
    expect(study.modifiedDateTime).toBe('2026-07-02T07:59:00');
  });
});
