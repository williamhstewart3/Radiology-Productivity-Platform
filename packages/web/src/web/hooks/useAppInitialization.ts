import { useEffect, useState } from 'react';
import { db } from '../db/database';
import { buildSeedCptRows } from '../data/seedCptData';
import { ensureCuratedRadiologyDictionarySeed } from '../data/radiologyExamDictionarySeed';
import { persistence } from '../services/persistence';
import { supabasePersistence } from '../services/supabasePersistence';
import { dedupeCptRvuRowsForBulkPut } from '../utils/cptRowDeduplication';
import { ensureCmsRvuFoundation } from '../services/cmsRvuFoundationService';

/**
 * Runs once on app startup:
 *  1. Ensures user_settings row exists.
 *  2. Ensures the full org -> practice -> radiologist hierarchy exists.
 *  3. Hydrates the active CMS/PPRRVU dataset only when remote persistence is explicitly enabled.
 *  4. Fills any missing codes from the official CMS July 2026 RVU release.
 *  5. Falls back to built-in seed CPT rows only when CMS is unreachable.
 */
export function useAppInitialization() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        await persistence.ensureInitialized();

        let loadedRemoteDataset = false;
        if (supabasePersistence.isConfigured()) {
          const dataset = await supabasePersistence.hydrateActiveRvuRowsIntoDexie();
          loadedRemoteDataset = Boolean(dataset && dataset.rowCount > 0);
        }

        try {
          await ensureCmsRvuFoundation();
        } catch (cmsError) {
          console.warn('Official CMS RVU foundation was unavailable; keeping the local dataset', cmsError);
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
