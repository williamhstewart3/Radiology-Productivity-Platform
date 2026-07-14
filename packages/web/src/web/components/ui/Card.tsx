import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SurfaceProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  as?: ElementType;
  variant?: 'default' | 'raised' | 'inset' | 'floating';
  interactive?: boolean;
  selected?: boolean;
}

const VARIANT_CLASS = {
  default: 'surface',
  raised: 'surface-raised',
  inset: 'surface-inset',
  floating: 'surface-floating',
} as const;

export function Surface({
  children,
  className,
  onClick,
  as,
  variant = 'default',
  interactive = false,
  selected = false,
}: SurfaceProps) {
  const Comp = (as ?? (onClick ? 'button' : 'section')) as ElementType;

  return (
    <Comp
      type={Comp === 'button' ? 'button' : undefined}
      onClick={onClick}
      aria-selected={interactive ? selected : undefined}
      className={cn(
        'rounded-[14px] p-4 text-left',
        VARIANT_CLASS[variant],
        (interactive || onClick) && 'interactive-surface min-h-11 w-full cursor-pointer',
        className,
      )}
    >
      {children}
    </Comp>
  );
}

export function InteractiveSurface(props: Omit<SurfaceProps, 'interactive'>) {
  return <Surface {...props} interactive />;
}

export function ElevatedSurface(props: Omit<SurfaceProps, 'variant'>) {
  return <Surface {...props} variant="raised" />;
}

export function InsetSurface(props: Omit<SurfaceProps, 'variant'>) {
  return <Surface {...props} variant="inset" />;
}

export function FloatingSurface(props: Omit<SurfaceProps, 'variant'>) {
  return <Surface {...props} variant="floating" />;
}

/** Backward-compatible name for screens still importing Card. */
export function Card(props: SurfaceProps) {
  return <Surface {...props} />;
}
