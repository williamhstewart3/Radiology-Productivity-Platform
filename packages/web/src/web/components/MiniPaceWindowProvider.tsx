import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MiniPaceWindow } from './MiniPaceWindow';
import {
  prepareMiniPacePipDocument,
  requestAlwaysOnTopMiniWindow,
  supportsAlwaysOnTopMiniWindow,
} from '../utils/documentPictureInPicture';

interface MiniPaceWindowContextValue {
  openMiniWindow: () => Promise<void>;
  alwaysOnTopSupported: boolean;
}

const MiniPaceWindowContext = createContext<MiniPaceWindowContextValue | null>(null);

export function MiniPaceWindowProvider({ children }: { children: ReactNode }) {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alwaysOnTopSupported = typeof window !== 'undefined' && supportsAlwaysOnTopMiniWindow(window);

  const openMiniWindow = useCallback(async () => {
    setError(null);
    try {
      const nextWindow = await requestAlwaysOnTopMiniWindow(window);
      prepareMiniPacePipDocument(nextWindow);
      nextWindow.addEventListener('pagehide', () => setPipWindow(null), { once: true });
      setPipWindow(nextWindow);
      nextWindow.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open the always-on-top mini window.');
    }
  }, []);

  const contextValue = useMemo(() => ({ openMiniWindow, alwaysOnTopSupported }), [alwaysOnTopSupported, openMiniWindow]);

  return (
    <MiniPaceWindowContext.Provider value={contextValue}>
      {children}
      {pipWindow && !pipWindow.closed && createPortal(
        <MiniPaceWindow
          targetWindow={pipWindow}
          onNavigate={(path) => {
            window.location.assign(path);
            window.focus();
          }}
        />,
        pipWindow.document.body,
      )}
      {error && (
        <div className="fixed bottom-4 left-1/2 z-[200] w-[min(92vw,34rem)] -translate-x-1/2 rounded-xl border border-amber-400/30 bg-rd-surface px-4 py-3 text-sm text-rd-label-primary shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <p>{error}</p>
            <button type="button" onClick={() => setError(null)} className="shrink-0 text-rd-label-secondary hover:text-rd-label-primary">Dismiss</button>
          </div>
        </div>
      )}
    </MiniPaceWindowContext.Provider>
  );
}

export function useMiniPaceWindow(): MiniPaceWindowContextValue {
  const value = useContext(MiniPaceWindowContext);
  if (!value) throw new Error('useMiniPaceWindow must be used within MiniPaceWindowProvider');
  return value;
}
