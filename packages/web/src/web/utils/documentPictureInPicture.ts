export interface DocumentPictureInPictureWindowOptions {
  width: number;
  height: number;
  disallowReturnToOpener?: boolean;
  preferInitialWindowPlacement?: boolean;
}

export interface DocumentPictureInPictureController {
  readonly window?: Window | null;
  requestWindow(options: DocumentPictureInPictureWindowOptions): Promise<Window>;
}

export const MINI_PACE_PIP_OPTIONS: DocumentPictureInPictureWindowOptions = {
  width: 320,
  height: 300,
  disallowReturnToOpener: true,
  // Let the browser remember the user's last size and placement.
  preferInitialWindowPlacement: false,
};

export function getDocumentPictureInPicture(host: unknown): DocumentPictureInPictureController | null {
  if (!host || typeof host !== 'object') return null;
  const controller = (host as { documentPictureInPicture?: DocumentPictureInPictureController })
    .documentPictureInPicture;
  return controller && typeof controller.requestWindow === 'function' ? controller : null;
}

export function supportsAlwaysOnTopMiniWindow(host: unknown): boolean {
  return getDocumentPictureInPicture(host) !== null;
}

export async function requestAlwaysOnTopMiniWindow(host: unknown): Promise<Window> {
  const controller = getDocumentPictureInPicture(host);
  if (!controller) throw new Error('This browser does not support an always-on-top mini window. Use a current version of Chrome or Edge.');

  const existing = controller.window;
  if (existing && !existing.closed) {
    existing.focus();
    return existing;
  }

  return controller.requestWindow(MINI_PACE_PIP_OPTIONS);
}

export function prepareMiniPacePipDocument(pipWindow: Window): void {
  pipWindow.document.documentElement.style.background = '#0A0E1A';
  pipWindow.document.documentElement.style.colorScheme = 'dark';
  pipWindow.document.body.style.margin = '0';
  pipWindow.document.body.style.minWidth = '280px';
  pipWindow.document.body.style.overflow = 'hidden auto';
}
