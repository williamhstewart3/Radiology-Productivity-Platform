import { describe, expect, test } from 'bun:test';
import {
  MINI_PACE_PIP_OPTIONS,
  requestAlwaysOnTopMiniWindow,
  supportsAlwaysOnTopMiniWindow,
} from '../src/web/utils/documentPictureInPicture';

describe('always-on-top mini pace window', () => {
  test('requires Document Picture-in-Picture instead of treating a popup as topmost', () => {
    expect(supportsAlwaysOnTopMiniWindow({})).toBe(false);
    expect(supportsAlwaysOnTopMiniWindow({ documentPictureInPicture: { requestWindow() {} } })).toBe(true);
  });

  test('requests the browser-owned topmost surface with the mini dimensions', async () => {
    let received: unknown;
    const createdWindow = { closed: false, focus() {} } as Window;
    const result = await requestAlwaysOnTopMiniWindow({
      documentPictureInPicture: {
        async requestWindow(options: unknown) {
          received = options;
          return createdWindow;
        },
      },
    });

    expect(result).toBe(createdWindow);
    expect(received).toEqual(MINI_PACE_PIP_OPTIONS);
    expect(MINI_PACE_PIP_OPTIONS.disallowReturnToOpener).toBe(true);
  });

  test('focuses and reuses the existing topmost window', async () => {
    let focusCount = 0;
    let requestCount = 0;
    const existingWindow = { closed: false, focus: () => focusCount++ } as Window;
    const result = await requestAlwaysOnTopMiniWindow({
      documentPictureInPicture: {
        window: existingWindow,
        async requestWindow() {
          requestCount++;
          return existingWindow;
        },
      },
    });

    expect(result).toBe(existingWindow);
    expect(focusCount).toBe(1);
    expect(requestCount).toBe(0);
  });
});
