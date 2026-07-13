/**
 * miniWindow.ts
 *
 * Single "open the Mini pace window" action shared by every entry point
 * (Today's control, the Ctrl/Cmd+M shortcut, the command palette). Three
 * possible outcomes, tried in order:
 *
 *   1. Document Picture-in-Picture (documentPictureInPicture.requestWindow) --
 *      a true OS-level always-on-top floating surface. Chromium/Edge only,
 *      feature-detected. The Mini renders into it directly from this same
 *      script context (no separate bundle load, no cross-tab liveness
 *      concern -- it's the same JS realm painting into another surface), so
 *      its stylesheets have to be copied in by hand -- a PiP document starts
 *      with none of the opener's <link>/<style> tags.
 *   2. A regular window.open() popup -- the pre-PiP fallback, unchanged.
 *   3. Blocked -- window.open returned null/closed (popup blocker,
 *      enterprise policy). Callers show the "allow popups" guidance.
 *
 * Also remembers the window's last size/position (Dexie userSettings) and
 * reuses it as the next request's dimensions, across all three paths.
 */

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '../db/database';
import { MiniPaceWindow } from '../components/MiniPaceWindow';
import { OrgProvider } from '../contexts/OrgContext';

export const DEFAULT_MINI_WINDOW_SIZE = { width: 320, height: 280 };

export type MiniWindowMode = 'pip' | 'popup' | 'blocked';

export interface OpenMiniWindowResult {
  mode: MiniWindowMode;
}

interface DocumentPictureInPictureLike {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}

function getDocumentPictureInPicture(): DocumentPictureInPictureLike | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { documentPictureInPicture?: DocumentPictureInPictureLike }).documentPictureInPicture ?? null;
}

export function supportsDocumentPictureInPicture(): boolean {
  return getDocumentPictureInPicture() !== null;
}

/**
 * A Document PiP window's document is blank -- none of the opener's
 * stylesheets carry over automatically. Copies both external <link>
 * stylesheets and inline <style> rules so the Mini's rd-* tokens, fonts, and
 * tabular-number formatting render identically to the popup/embedded paths.
 */
export function copyStylesInto(targetDocument: Document): void {
  for (const styleSheet of Array.from(document.styleSheets)) {
    try {
      if (styleSheet.href) {
        const link = targetDocument.createElement('link');
        link.rel = 'stylesheet';
        link.href = styleSheet.href;
        targetDocument.head.appendChild(link);
      } else {
        const style = targetDocument.createElement('style');
        style.textContent = Array.from(styleSheet.cssRules).map((rule) => rule.cssText).join('\n');
        targetDocument.head.appendChild(style);
      }
    } catch {
      // Cross-origin stylesheets throw reading .cssRules -- nothing to copy.
    }
  }
}

async function openPictureInPictureMini(width: number, height: number): Promise<boolean> {
  const pip = getDocumentPictureInPicture();
  if (!pip) return false;
  try {
    const pipWindow = await pip.requestWindow({ width, height });
    copyStylesInto(pipWindow.document);
    pipWindow.document.documentElement.classList.add('rd-dark', 'dark');
    pipWindow.document.body.style.margin = '0';
    const mainWindow = window;
    const root = createRoot(pipWindow.document.body);
    root.render(
      createElement(
        OrgProvider,
        null,
        createElement(MiniPaceWindow, {
          embedded: true,
          onNavigate: (path: string) => {
            mainWindow.location.assign(path);
            mainWindow.focus();
          },
        }),
      ),
    );
    pipWindow.addEventListener('pagehide', () => root.unmount(), { once: true });
    return true;
  } catch {
    return false;
  }
}

export async function openMiniWindow(): Promise<OpenMiniWindowResult> {
  if (typeof window === 'undefined') return { mode: 'blocked' };

  const settings = await db.userSettings.get('default');
  const bounds = settings?.miniWindowBounds;
  const width = bounds?.width ?? DEFAULT_MINI_WINDOW_SIZE.width;
  const height = bounds?.height ?? DEFAULT_MINI_WINDOW_SIZE.height;

  if (await openPictureInPictureMini(width, height)) return { mode: 'pip' };

  const positionFeatures = bounds?.left != null && bounds?.top != null ? `,left=${bounds.left},top=${bounds.top}` : '';
  const url = new URL('/?mini=pace', window.location.origin).toString();
  const popup = window.open(
    url,
    'wrvu-mini-pace',
    `width=${width},height=${height}${positionFeatures},resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no`,
  );

  if (!popup || popup.closed) return { mode: 'blocked' };
  popup.focus();
  return { mode: 'popup' };
}

export async function saveMiniWindowBounds(bounds: { width: number; height: number; left: number | null; top: number | null }): Promise<void> {
  const settings = await db.userSettings.get('default');
  if (!settings) return;
  await db.userSettings.update('default', { miniWindowBounds: bounds });
}
