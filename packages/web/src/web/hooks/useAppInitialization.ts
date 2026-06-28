import { useEffect, useState } from 'react';
import { db, ensureUserSettings } from '../db/database';
import { buildSeedCptRows } from '../data/seedCptData';

/**
 * Runs once on app startup: ensures user_settings exists and seeds the
 * verified CPT rows if the cpt_rvu_table is completely empty. If the user
 * has already imported a real RVU file, this is a no-op.
 */
export function useAppInitialization() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        await ensureUserSettings();

        const existingCount = await db.cptRvuTable.count();
        if (existingCount === 0) {
          const seedRows = buildSeedCptRows();
          await db.cptRvuTable.bulkPut(seedRows);
        }

        if (mounted) setIsReady(true);
      } catch (err) {
        console.error('App initialization failed', err);
        if (mounted) setError(err instanceof Error ? err.message : 'Unknown initialization error');
      }
    }

    init();
    return () => {
      mounted = false;
    };
  }, []);

  return { isReady, error };
}
