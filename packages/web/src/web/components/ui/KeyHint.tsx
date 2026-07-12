export function KeyHint({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-rd-separator bg-rd-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-rd-label-secondary">{children}</kbd>;
}
