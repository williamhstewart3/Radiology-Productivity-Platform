import { useCallback, useState } from 'react';
import { openMiniWindow } from '../utils/miniWindow';
import { isDesktop } from '../lib/desktop';

/**
 * Shared "open the Mini window" state machine for every entry point
 * (Today's control, the global Ctrl/Cmd+M shortcut, the command palette).
 * Surfaces exactly two things callers need to react to: the popup-blocked
 * guidance (window.open returned null) and a one-line "automatic floating
 * isn't available in this browser" note (opened as a regular window because
 * Document Picture-in-Picture isn't supported here and this isn't the
 * desktop shell either).
 */
export function useMiniWindowLauncher() {
  const [blocked, setBlocked] = useState(false);
  const [floatingUnavailable, setFloatingUnavailable] = useState(false);

  const openMini = useCallback(() => {
    void openMiniWindow().then(({ mode }) => {
      if (mode === 'blocked') {
        setBlocked(true);
      } else if (mode === 'popup' && !isDesktop()) {
        setFloatingUnavailable(true);
      }
    });
  }, []);

  return {
    openMini,
    blocked,
    dismissBlocked: () => setBlocked(false),
    floatingUnavailable,
    dismissFloatingUnavailable: () => setFloatingUnavailable(false),
  };
}
