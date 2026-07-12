import { describe, expect, test } from 'bun:test';
import { effectiveAutoCommitThreshold } from '../src/web/services/automationSettings';
import { watcherReceiptBody } from '../src/web/services/notificationReceipts';

describe('Automation settings', () => {
  test('uses the pipeline default and applies the next saved threshold', () => {
    expect(effectiveAutoCommitThreshold(undefined)).toBe(0.95);
    expect(effectiveAutoCommitThreshold(0.98)).toBe(0.98);
    expect(effectiveAutoCommitThreshold(1)).toBe(0.99);
  });

  test('creates one batch-level receipt summary', () => {
    expect(watcherReceiptBody(11, 2)).toBe('9 counted quietly, 2 in Inbox');
  });
});
