import { describe, expect, test } from 'bun:test';
import { missingCmsFoundationRows } from '../src/web/services/cmsRvuFoundationService';
import type { CptRvuRow } from '../src/web/types';
import type { ParsedRvuRow } from '../src/web/utils/rvuFileImporter';

function parsed(cptCode: string, description: string, workRvu: number): ParsedRvuRow {
  return {
    cptCode,
    modifier: '26',
    description,
    statusCode: 'A',
    workRvu,
    nonFacilityPeRvu: 0,
    facilityPeRvu: 0,
    malpracticeRvu: 0,
    totalRvuNonFacility: workRvu,
    totalRvuFacility: workRvu,
    pcTcIndicator: 'professional',
    globalDays: 'XXX',
  };
}

function existing(cptCode: string): CptRvuRow {
  return {
    id: `existing_${cptCode}`,
    cptCode,
    modifier: '26',
    description: 'Locally verified title',
    workRvu: 9.99,
    nonFacilityPeRvu: null,
    facilityPeRvu: null,
    malpracticeRvu: null,
    totalRvuNonFacility: null,
    totalRvuFacility: null,
    statusCode: 'A',
    statusCategory: 'active',
    globalDays: null,
    pcTcIndicator: 'professional',
    modality: 'CT',
    rvuFileVersion: 'LOCAL',
    effectiveDate: '2026-01-01',
    includeInAutoMatch: true,
    autoMatchSource: 'institution',
    isUserVerified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('CMS RVU foundation', () => {
  test('fills missing official codes without replacing an existing curated row', () => {
    const rows = missingCmsFoundationRows([
      parsed('71270', 'Ct thorax w/o & w/dye', 1.22),
      parsed('73221', 'Mri joint upr extrem w/o dye', 1.32),
    ], [existing('71270')]);

    expect(rows.map((row) => row.cptCode)).toEqual(['73221']);
    expect(rows[0]).toMatchObject({
      modifier: '26',
      workRvu: 1.32,
      rvuFileVersion: 'CMS_RVU26C_2026_07',
      includeInAutoMatch: true,
    });
  });
});
