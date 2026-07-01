import { db } from '../db/database';
import type { AuditLogEntry } from '../types';

export async function recordAuditEvent(input: Omit<AuditLogEntry, 'id' | 'createdAt'>): Promise<void> {
  await db.auditLogEntries.add({
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  });
}

