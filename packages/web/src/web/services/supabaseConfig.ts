export interface SupabaseSyncConfig {
  enabled?: string;
  url?: string;
  anonKey?: string;
}

export function hasSupabaseCredentials(config: SupabaseSyncConfig): boolean {
  return Boolean(config.url && config.anonKey);
}

export function isSupabaseSyncEnabled(config: SupabaseSyncConfig): boolean {
  return config.enabled === 'true' && hasSupabaseCredentials(config);
}
