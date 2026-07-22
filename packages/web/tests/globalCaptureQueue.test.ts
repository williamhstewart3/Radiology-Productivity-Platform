import { describe, expect, test } from 'bun:test';
import { clearGlobalCapture, enqueueGlobalCapture, subscribeGlobalCapture } from '../src/web/services/globalCaptureQueue';

describe('global capture queue', () => {
  test('hands a capture to the next mounted listener exactly once', async () => {
    const payload = { kind: 'text' as const, text: 'ct head', source: 'paste' as const };
    enqueueGlobalCapture(payload);
    const received: typeof payload[] = [];
    const unsubscribe = subscribeGlobalCapture((item) => {
      received.push(item as typeof payload);
      clearGlobalCapture(item);
    });
    await Promise.resolve();
    unsubscribe();

    expect(received).toEqual([payload]);
  });
});
