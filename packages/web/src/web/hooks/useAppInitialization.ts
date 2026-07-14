import { useEffect, useState } from 'react';
import { db, ensureOrgHierarchy } from '../db/database';
import { buildSeedCptRows } from '../data/seedCptData';
import { ensureCuratedRadiologyDictionarySeed } from '../data/radiologyExamDictionarySeed';
import { persistence } from '../services/persistence';
import { supabasePersistence } from '../services/supabasePersistence';
import { dedupeCptRvuRowsForBulkPut } from '../utils/cptRowDeduplication';
import type { StudyLog } from '../types';

async function seedVisualFixtureData() {
  const { profile } = await ensureOrgHierarchy();
  const now = new Date();
  const day = (offset: number) => {
    const value = new Date(now);
    value.setDate(value.getDate() - offset);
    return value.toISOString().slice(0, 10);
  };
  const studies = [
    ['CT chest with contrast', '71260', 'CT', 1.82],
    ['MRI brain without contrast', '70551', 'MRI', 1.48],
    ['Chest radiograph, 2 views', '71046', 'XR', 0.22],
    ['Ultrasound abdomen complete', '76700', 'US', 0.81],
    ['CTA head and neck', '70496', 'CT', 2.31],
    ['Screening mammography, bilateral', '77067', 'MAMMO', 1.20],
  ] as const;
  const logs: StudyLog[] = Array.from({ length: 18 }, (_, index) => {
    const study = studies[index % studies.length];
    const logDate = day(Math.floor(index / 6));
    const hour = 8 + (index % 6);
    const timestamp = `${logDate}T${String(hour).padStart(2, '0')}:${index % 2 ? '36' : '12'}:00.000Z`;
    return {
      id: `visual-study-${index}`,
      profileId: profile.id,
      logDate,
      studyDate: logDate,
      studyDateTime: timestamp,
      examDateTime: timestamp,
      dateTimeConfidence: index === 4 ? 0.62 : 0.98,
      dateTimeSource: index === 4 ? 'import_default' : 'ocr',
      examNameRaw: study[0],
      examTitleNormalized: study[0].toLowerCase(),
      examTitleDisplay: study[0],
      cmsDescription: study[0],
      cptCode: study[1],
      modifier: '26',
      workRvu: study[3],
      modality: study[2],
      matchMethod: index === 4 ? 'ocr_match' : 'radiology_match',
      matchConfidence: index === 4 ? 0.68 : 0.98,
      needsReview: index === 4,
      accessionNumber: `VIS${String(index + 1).padStart(5, '0')}`,
      sessionId: null,
      sourceImportId: index < 6 ? 'visual-recent-batch' : null,
      notes: null,
      studyFingerprint: `visual-fingerprint-${index}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
  await db.studyLogs.bulkPut(logs);
  await db.cptRvuTable.bulkPut(buildSeedCptRows().slice(0, 80));
}

/**
 * Runs once on app startup:
 *  1. Ensures user_settings row exists.
 *  2. Ensures the full org -> practice -> radiologist hierarchy exists.
 *  3. Hydrates the active CMS/PPRRVU dataset only when remote persistence is explicitly enabled.
 *  4. Falls back to built-in seed CPT rows only when no remote dataset exists.
 */
export function useAppInitialization() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        await persistence.ensureInitialized();

        if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('visual-test') === '1') {
          await seedVisualFixtureData();
          if (mounted) setIsReady(true);
          return;
        }

        let loadedRemoteDataset = false;
        if (supabasePersistence.isConfigured()) {
          const dataset = await supabasePersistence.hydrateActiveRvuRowsIntoDexie();
          loadedRemoteDataset = Boolean(dataset && dataset.rowCount > 0);
        }

        const existingCount = await db.cptRvuTable.count();
        if (!loadedRemoteDataset && existingCount === 0) {
          const seedRows = dedupeCptRvuRowsForBulkPut(buildSeedCptRows(), 'startup CPT seed');
          await db.cptRvuTable.bulkPut(seedRows);
        }

        await ensureCuratedRadiologyDictionarySeed();

        if (mounted) setIsReady(true);
      } catch (err) {
        console.error('App initialization failed', err);
        if (mounted) setError(err instanceof Error ? err.message : 'Unknown initialization error');
      }
    }

    init();
    return () => { mounted = false; };
  }, []);

  return { isReady, error };
}
