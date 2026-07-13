import { describe, expect, test } from 'bun:test';
import { CaptureTimer, formatCaptureTimings, summarizeBatchTimings } from '../src/web/utils/captureTimings';

function fakeClock(steps: number[]): () => number {
  let i = -1;
  return () => {
    i += 1;
    return steps[Math.min(i, steps.length - 1)];
  };
}

describe('CaptureTimer', () => {
  test('records the elapsed time between marks, not since construction', () => {
    const clock = fakeClock([0, 100, 350, 500]);
    const timer = new CaptureTimer(clock);
    timer.mark('prep');
    timer.mark('ocr');
    timer.mark('commit');
    expect(timer.stages()).toEqual([
      { stage: 'prep', durationMs: 100 },
      { stage: 'ocr', durationMs: 250 },
      { stage: 'commit', durationMs: 150 },
    ]);
  });

  test('totalMs reflects elapsed time since construction regardless of marks', () => {
    const clock = fakeClock([0, 100, 900]);
    const timer = new CaptureTimer(clock);
    timer.mark('prep');
    expect(timer.totalMs()).toBe(900);
  });
});

describe('summarizeBatchTimings', () => {
  test('sums same-named stages across rows and totals elapsed time', () => {
    const clockA = fakeClock([0, 100, 300]);
    const timerA = new CaptureTimer(clockA);
    timerA.mark('ocr');
    timerA.mark('match');

    const clockB = fakeClock([0, 150, 400]);
    const timerB = new CaptureTimer(clockB);
    timerB.mark('ocr');
    timerB.mark('match');

    const summary = summarizeBatchTimings([timerA, timerB]);
    expect(summary.rowCount).toBe(2);
    expect(summary.totalMs).toBe(300 + 400);
    expect(summary.byStage).toEqual([
      { stage: 'ocr', durationMs: 100 + 150 },
      { stage: 'match', durationMs: 200 + 250 },
    ]);
  });

  test('handles an empty batch', () => {
    const summary = summarizeBatchTimings([]);
    expect(summary).toEqual({ rowCount: 0, totalMs: 0, byStage: [] });
  });
});

describe('formatCaptureTimings', () => {
  test('formats a compact stage breakdown, dropping sub-millisecond stages', () => {
    const summary = { rowCount: 1, totalMs: 1234, byStage: [{ stage: 'ocr', durationMs: 900 }, { stage: 'match', durationMs: 300 }, { stage: 'noise', durationMs: 0.2 }] };
    expect(formatCaptureTimings(summary)).toBe('1234ms total (ocr 900ms · match 300ms)');
  });

  test('returns an empty string for an empty batch', () => {
    expect(formatCaptureTimings({ rowCount: 0, totalMs: 0, byStage: [] })).toBe('');
  });
});
