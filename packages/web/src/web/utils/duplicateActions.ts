/**
 * duplicateActions.ts
 *
 * Recommends which of the Inbox's three duplicate-card verbs (skip / update
 * existing / count both) fits a "possible duplicate" row, given the actual
 * stored StudyLog it collided with. Kept separate from duplicateDetection.ts
 * -- that module only runs once at import time and discards the matched
 * StudyLog's fields once it hands back an id; this recommendation needs the
 * full stored record, so it's computed fresh when the Inbox card renders.
 */

import { sameMinute } from './duplicateDetection';
import { normalizeExamText } from './textMatching';
import type { ImportedStudy } from '../types/importProvider';
import type { StudyLog } from '../types';

/** null means no change from today's default -- "Same study — skip" stays the recommended/primary verb. */
export type DuplicateRecommendation = 'update_existing' | null;

/**
 * An addendum touch: the radiologist re-scanned the same PowerScribe window
 * after adding an addendum. Same procedure, same performed/exam time, but a
 * later Modified (read) time than what's already stored -- nothing about
 * the exam itself changed, only its record needs a fresher touch.
 */
export function isAddendumTouch(source: ImportedStudy, existingLog: StudyLog): boolean {
  const incomingName = source.procedureName ?? source.examTitle ?? '';
  const existingName = existingLog.examTitleDisplay ?? existingLog.examNameRaw ?? '';
  if (normalizeExamText(incomingName) !== normalizeExamText(existingName)) return false;

  const incomingExamDateTime = source.examDateTime ?? null;
  const existingExamDateTime = existingLog.examDateTime ?? null;
  if (!incomingExamDateTime || !existingExamDateTime) return false;
  if (!sameMinute(incomingExamDateTime, existingExamDateTime)) return false;

  const incomingModified = source.modifiedDateTime ?? source.studyTime ?? null;
  const existingModified = existingLog.studyDateTime ?? null;
  if (!incomingModified || !existingModified) return false;

  const incomingTime = new Date(incomingModified).getTime();
  const existingTime = new Date(existingModified).getTime();
  if (Number.isNaN(incomingTime) || Number.isNaN(existingTime)) return false;

  return incomingTime > existingTime;
}

export function recommendedDuplicateAction(source: ImportedStudy, existingLog: StudyLog | null | undefined): DuplicateRecommendation {
  if (existingLog && isAddendumTouch(source, existingLog)) return 'update_existing';
  return null;
}
