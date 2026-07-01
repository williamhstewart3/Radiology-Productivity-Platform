import { useEffect, useState } from 'react';
import { db } from '../db/database';
import { buildSeedCptRows } from '../data/seedCptData';
import { ensureCuratedRadiologyDictionarySeed } from '../data/radiologyExamDictionarySeed';
import { persistence } from '../services/persistence';
import { supabasePersistence } from '../services/supabasePersistence';

/**
 * Runs once on app startup:
 *  1. Ensures user_settings row exists.
 *  2. Ensures the full org -> practice -> radiologist hierarchy exists.
 *  3. Hydrates the active CMS/PPRRVU dataset from Supabase when configured.
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

        let loadedRemoteDataset = false;
        if (supabasePersistence.isConfigured()) {
          const dataset = await supabasePersistence.hydrateActiveRvuRowsIntoDexie();
          loadedRemoteDataset = Boolean(dataset && dataset.rowCount > 0);
        }

        const existingCount = await db.cptRvuTable.count();
        if (!loadedRemoteDataset && existingCount === 0) {
          const seedRows = buildSeedCptRows();
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
