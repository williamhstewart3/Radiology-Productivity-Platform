import { describe, expect, test } from 'bun:test';
import { batchConfirmLine, type RecentBatch } from '../src/web/services/studyLogService';

function batch(overrides: Partial<RecentBatch> = {}): RecentBatch {
  return {
    sourceImportId: 'batch_1',
    sourceLabel: 'Screenshot',
    capturedAt: '2026-07-13T14:07:00.000Z',
    studyCount: 5,
    totalWrvu: 5.1,
    logIds: ['a', 'b', 'c', 'd', 'e'],
    ...overrides,
  };
}

describe('batchConfirmLine — the batch-undo one-line confirm', () => {
  test('matches the ticket\'s exact example shape', () => {
    // 2026-07-13T14:07:00.000Z is 2:07 PM UTC; the confirm line always renders
    // in the browser's local zone, so assert on the stable parts only.
    const line = batchConfirmLine(batch());
    expect(line).toMatch(/^Remove 5 studies · 5\.1 wRVU · captured \d{1,2}:\d{2}[ap]$/);
  });

  test('singular "study" for a batch of one', () => {
    const line = batchConfirmLine(batch({ studyCount: 1, totalWrvu: 2.5 }));
    expect(line).toContain('Remove 1 study ·');
  });

  test('wRVU is always shown to one decimal', () => {
    const line = batchConfirmLine(batch({ totalWrvu: 3 }));
    expect(line).toContain('3.0 wRVU');
  });
});
