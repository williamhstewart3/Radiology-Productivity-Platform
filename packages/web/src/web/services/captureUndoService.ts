import { db } from '../db/database';
import type {
  ActiveReviewSession,
  AuditLogEntry,
  ExamAlias,
  ExamDictionaryEntry,
  OcrLearningEntry,
  StudyLog,
} from '../types';

export interface CaptureUndoSnapshot {
  studyLogs: StudyLog[];
  examAliases: ExamAlias[];
  examDictionary: ExamDictionaryEntry[];
  ocrLearningEntries: OcrLearningEntry[];
  activeReviewSessions: ActiveReviewSession[];
  auditLogEntries: AuditLogEntry[];
}

export async function snapshotCaptureState(): Promise<CaptureUndoSnapshot> {
  const [studyLogs, examAliases, examDictionary, ocrLearningEntries, activeReviewSessions, auditLogEntries] = await Promise.all([
    db.studyLogs.toArray(),
    db.examAliases.toArray(),
    db.examDictionary.toArray(),
    db.ocrLearningEntries.toArray(),
    db.activeReviewSessions.toArray(),
    db.auditLogEntries.toArray(),
  ]);
  return { studyLogs, examAliases, examDictionary, ocrLearningEntries, activeReviewSessions, auditLogEntries };
}

export async function restoreCaptureState(snapshot: CaptureUndoSnapshot): Promise<void> {
  await db.transaction(
    'rw',
    db.studyLogs,
    db.examAliases,
    db.examDictionary,
    db.ocrLearningEntries,
    db.activeReviewSessions,
    db.auditLogEntries,
    async () => {
      await Promise.all([
        db.studyLogs.clear(),
        db.examAliases.clear(),
        db.examDictionary.clear(),
        db.ocrLearningEntries.clear(),
        db.activeReviewSessions.clear(),
        db.auditLogEntries.clear(),
      ]);
      await Promise.all([
        db.studyLogs.bulkPut(snapshot.studyLogs),
        db.examAliases.bulkPut(snapshot.examAliases),
        db.examDictionary.bulkPut(snapshot.examDictionary),
        db.ocrLearningEntries.bulkPut(snapshot.ocrLearningEntries),
        db.activeReviewSessions.bulkPut(snapshot.activeReviewSessions),
        db.auditLogEntries.bulkPut(snapshot.auditLogEntries),
      ]);
    },
  );
}
