/**
 * miniWindow.ts
 *
 * Single "open the Mini pace window" action shared by every entry point
 * (Today's control, the Ctrl/Cmd+M shortcut, the command palette). Remembers
 * the popup's last size/position (Dexie userSettings) and reports whether
 * the browser blocked the popup so callers can show the "allow popups for
 * this site" guidance instead of failing silently.
 */

import { db } from '../db/database';

export const DEFAULT_MINI_WINDOW_SIZE = { width: 320, height: 280 };

export interface OpenMiniWindowResult {
  popup: Window | null;
  /** True when window.open returned null/closed -- the browser (or an enterprise policy) blocked the popup. */
  blocked: boolean;
}

export async function openMiniWindow(): Promise<OpenMiniWindowResult> {
  if (typeof window === 'undefined') return { popup: null, blocked: true };

  const settings = await db.userSettings.get('default');
  const bounds = settings?.miniWindowBounds;
  const width = bounds?.width ?? DEFAULT_MINI_WINDOW_SIZE.width;
  const height = bounds?.height ?? DEFAULT_MINI_WINDOW_SIZE.height;
  const positionFeatures = bounds?.left != null && bounds?.top != null ? `,left=${bounds.left},top=${bounds.top}` : '';

  const url = new URL('/?mini=pace', window.location.origin).toString();
  const popup = window.open(
    url,
    'wrvu-mini-pace',
    `width=${width},height=${height}${positionFeatures},resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no`,
  );

  if (!popup || popup.closed) return { popup: null, blocked: true };
  popup.focus();
  return { popup, blocked: false };
}

export async function saveMiniWindowBounds(bounds: { width: number; height: number; left: number | null; top: number | null }): Promise<void> {
  const settings = await db.userSettings.get('default');
  if (!settings) return;
  await db.userSettings.update('default', { miniWindowBounds: bounds });
}
