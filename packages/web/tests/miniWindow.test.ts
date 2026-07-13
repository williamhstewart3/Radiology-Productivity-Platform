import { describe, expect, test, afterEach } from 'bun:test';
import { supportsDocumentPictureInPicture } from '../src/web/utils/miniWindow';

describe('supportsDocumentPictureInPicture feature-detection', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  test('false when window is undefined (SSR/non-browser context)', () => {
    (globalThis as { window?: unknown }).window = undefined;
    expect(supportsDocumentPictureInPicture()).toBe(false);
  });

  test('false when the API is absent (the browser fallback / enterprise-disabled path)', () => {
    (globalThis as { window?: unknown }).window = {};
    expect(supportsDocumentPictureInPicture()).toBe(false);
  });

  test('true when documentPictureInPicture is present on window', () => {
    (globalThis as { window?: unknown }).window = { documentPictureInPicture: { requestWindow: async () => ({}) } };
    expect(supportsDocumentPictureInPicture()).toBe(true);
  });
});
