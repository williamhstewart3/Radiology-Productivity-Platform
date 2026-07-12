export type GlobalCapturePayload =
  | { kind: 'file'; file: File; source: 'paste' | 'drop' }
  | { kind: 'text'; text: string; source: 'paste' | 'drop' };

let pending: GlobalCapturePayload | null = null;
const listeners = new Set<(payload: GlobalCapturePayload) => void>();

export function enqueueGlobalCapture(payload: GlobalCapturePayload): void {
  pending = payload;
  for (const listener of listeners) listener(payload);
}

export function subscribeGlobalCapture(listener: (payload: GlobalCapturePayload) => void): () => void {
  listeners.add(listener);
  if (pending) {
    const payload = pending;
    pending = null;
    queueMicrotask(() => listener(payload));
  }
  return () => listeners.delete(listener);
}

export function clearGlobalCapture(payload: GlobalCapturePayload): void {
  if (pending === payload) pending = null;
}
