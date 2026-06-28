import { useEffect, useState } from 'react';
import { db, ensureUserSettings, ensureOrgHierarchy } from '../db/database';
import { buildSeedCptRows } from '../data/seedCptData';

/**
 * Runs once on app startup:
 *  1. Ensures user_settings row exists.
 *  2. Ensures the full org → practice → radiologist hierarchy exists.
 *  3. Seeds CPT rows if the table is empty.
 */
export function useAppInitialization() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        await ensureUserSettings();
        await ensureOrgHierarchy();

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
    return () => { mounted = false; };
  }, []);

  return { isReady, error };
}
