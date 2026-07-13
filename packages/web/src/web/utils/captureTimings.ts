/**
 * captureTimings.ts
 *
 * Per-stage wall-clock instrumentation for a single capture (image prep ->
 * OCR -> normalize -> match -> dedupe -> commit). A CaptureTimer collects
 * marks as the pipeline runs; formatCaptureTimings turns a finished timer
 * (or several, for a batch) into the compact line shown in the capture
 * receipt / Details disclosure.
 */

export interface StageTiming {
  stage: string;
  durationMs: number;
}

export class CaptureTimer {
  private marks: StageTiming[] = [];
  private cursor: number;
  private readonly start: number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
    this.start = now();
    this.cursor = this.start;
  }

  private readonly now: () => number;

  /** Records the elapsed time since the previous mark (or construction) under `stage`. */
  mark(stage: string): void {
    const t = this.now();
    this.marks.push({ stage, durationMs: t - this.cursor });
    this.cursor = t;
  }

  stages(): StageTiming[] {
    return [...this.marks];
  }

  totalMs(): number {
    return this.now() - this.start;
  }
}

export interface BatchTimingSummary {
  rowCount: number;
  totalMs: number;
  byStage: StageTiming[];
}

/** Sums same-named stages across one CaptureTimer per row into a per-batch total. */
export function summarizeBatchTimings(timers: CaptureTimer[]): BatchTimingSummary {
  const byStage = new Map<string, number>();
  let totalMs = 0;
  for (const timer of timers) {
    for (const { stage, durationMs } of timer.stages()) {
      byStage.set(stage, (byStage.get(stage) ?? 0) + durationMs);
    }
    totalMs += timer.totalMs();
  }
  return {
    rowCount: timers.length,
    totalMs,
    byStage: [...byStage.entries()].map(([stage, durationMs]) => ({ stage, durationMs })),
  };
}

export function formatCaptureTimings(summary: BatchTimingSummary): string {
  if (summary.rowCount === 0) return '';
  const stageParts = summary.byStage
    .filter((s) => s.durationMs >= 1)
    .map((s) => `${s.stage} ${Math.round(s.durationMs)}ms`)
    .join(' · ');
  return `${Math.round(summary.totalMs)}ms total${stageParts ? ` (${stageParts})` : ''}`;
}
