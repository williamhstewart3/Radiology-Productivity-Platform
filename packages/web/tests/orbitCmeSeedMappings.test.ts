import { describe, expect, test } from 'bun:test';
import { buildOrbitCmeSeedCptRows, findOrbitCmeSeedMapping, getOrbitCmeSeedMappings } from '../src/web/data/orbitCmeSeedMappings';
import { buildOrbitModalityRepairs } from '../src/web/data/radiologyExamDictionarySeed';

describe('Orbit CME modality/anatomy reference', () => {
  test('loads the complete posted table as structured rows', () => {
    expect(getOrbitCmeSeedMappings()).toHaveLength(628);
  });

  test('resolves unique common titles even when OCR loses the modality token', () => {
    expect(findOrbitCmeSeedMapping('ABDOMEN COMPLETE')?.cptCode).toBe('76700');
    expect(findOrbitCmeSeedMapping('CAROTID DUPLEX BILATERAL')?.cptCode).toBe('93880');
    expect(findOrbitCmeSeedMapping('OB LIMITED')?.cptCode).toBe('76815');
  });

  test('classifies vascular studies as ultrasound in the modality-first hierarchy', () => {
    const rows = buildOrbitCmeSeedCptRows();
    expect(rows.find((row) => row.cptCode === '93880')?.modality).toBe('US');
    expect(rows.find((row) => row.cptCode === '93970')?.modality).toBe('US');
  });

  test('repairs existing CMS rows without overwriting user-verified modality choices', () => {
    const reference = buildOrbitCmeSeedCptRows().find((row) => row.cptCode === '93880')!;
    const cmsRow = { ...reference, id: 'cms_93880', modality: 'OTHER' as const, isUserVerified: false };
    const verifiedRow = { ...reference, id: 'verified_93880', modality: 'OTHER' as const, isUserVerified: true };

    expect(buildOrbitModalityRepairs([cmsRow], [reference], '2026-07-14T00:00:00.000Z')[0]).toMatchObject({
      id: 'cms_93880',
      modality: 'US',
      updatedAt: '2026-07-14T00:00:00.000Z',
    });
    expect(buildOrbitModalityRepairs([verifiedRow], [reference])).toEqual([]);
  });
});
