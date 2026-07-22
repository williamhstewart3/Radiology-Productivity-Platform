export function effectiveAutoCommitThreshold(value: number | null | undefined): number {
  return Math.min(0.99, Math.max(0.95, value ?? 0.95));
}
