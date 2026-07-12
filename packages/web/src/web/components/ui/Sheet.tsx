import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

/** Bottom sheet on mobile widths, centered card on wider screens. Springs up. */
export function Sheet({ open, onClose, title, children, className }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/40 sm:items-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        className={cn(
          'rd-motion-safe relative w-full max-w-md rounded-t-[20px] bg-rd-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-[20px] sm:pb-4',
          className,
        )}
        style={{
          boxShadow: '0 -4px 24px rgba(0,0,0,0.12)',
          animation: 'rd-sheet-up 320ms cubic-bezier(0.32,0.72,0,1)',
        }}
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-rd-separator sm:hidden" />
        {title && <h2 className="mb-2 text-[17px] font-semibold text-rd-label-primary">{title}</h2>}
        {children}
      </div>
      <style>{`
        @keyframes rd-sheet-up {
          from { transform: translateY(24px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .rd-motion-safe { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
