import type { ComponentType } from 'react';
import { Link, useLocation } from 'wouter';
import { cn } from '@/lib/utils';

export interface TabItem {
  path: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface TabBarProps {
  items: TabItem[];
}

function isActive(location: string, path: string): boolean {
  return location === path || (path !== '/' && location.startsWith(path));
}

/**
 * Two independent components sharing one `items` list: mount `SidebarNav`
 * inside a `hidden md:flex` sidebar container, and `BottomTabBar` at the top
 * level of the shell (its own position:fixed — do NOT nest it under an
 * ancestor that's `display:none` on mobile, or it disappears with it).
 */
export function SidebarNav({ items }: TabBarProps) {
  const [location] = useLocation();
  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto" aria-label="Primary">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(location, item.path);
        return (
          <Link
            key={item.path}
            href={item.path}
            className={cn(
              'flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium transition-colors',
              active ? 'bg-rd-accent/12 text-rd-accent' : 'text-rd-label-secondary hover:bg-rd-surface',
            )}
          >
            <Icon className="size-5 shrink-0" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomTabBar({ items }: TabBarProps) {
  const [location] = useLocation();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 grid border-t border-rd-separator bg-rd-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      aria-label="Primary"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(location, item.path);
        return (
          <Link
            key={item.path}
            href={item.path}
            className={cn(
              'flex min-h-11 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium transition-colors',
              active ? 'text-rd-accent' : 'text-rd-label-secondary',
            )}
          >
            <Icon className="size-5" />
            <span className="max-w-full truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
