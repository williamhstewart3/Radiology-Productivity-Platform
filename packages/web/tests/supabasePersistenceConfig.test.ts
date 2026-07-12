import { describe, expect, test } from 'bun:test';
import {
  hasSupabaseCredentials,
  isSupabaseSyncEnabled,
} from '../src/web/services/supabaseConfig';

describe('Supabase privacy gate', () => {
  test('is disabled by default even when credentials are present', () => {
    const config = { url: 'https://example.supabase.co', anonKey: 'test-key' };

    expect(hasSupabaseCredentials(config)).toBe(true);
    expect(isSupabaseSyncEnabled(config)).toBe(false);
  });

  test('is disabled when the flag is false', () => {
    expect(isSupabaseSyncEnabled({
      enabled: 'false',
      url: 'https://example.supabase.co',
      anonKey: 'test-key',
    })).toBe(false);
  });

  test('requires both explicit enablement and complete credentials', () => {
    expect(isSupabaseSyncEnabled({ enabled: 'true', url: 'https://example.supabase.co' })).toBe(false);
    expect(isSupabaseSyncEnabled({ enabled: 'true', anonKey: 'test-key' })).toBe(false);
    expect(isSupabaseSyncEnabled({
      enabled: 'true',
      url: 'https://example.supabase.co',
      anonKey: 'test-key',
    })).toBe(true);
  });
});
