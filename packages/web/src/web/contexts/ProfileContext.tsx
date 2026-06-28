/**
 * ProfileContext.tsx — compatibility shim.
 * Functionality moved to OrgContext. Re-exports to avoid import churn.
 */
export { OrgProvider as ProfileProvider, useProfile } from './OrgContext';
