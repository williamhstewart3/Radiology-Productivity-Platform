/**
 * useProfile.ts
 *
 * Backward-compat re-export. All existing code that imports useProfile()
 * continues to work — it now reads from OrgContext instead of ProfileContext.
 */
export { useProfile } from '../contexts/OrgContext';
