/**
 * Supabase client for Next.js Server Components.
 *
 * Uses the service_role key which bypasses RLS. This is safe because
 * Server Components run ONLY on the server — the key never reaches
 * the browser. The dashboard is internal (no public API exposed).
 *
 * Singleton: the client is created once and reused across all requests
 * within the same server process. Each page load makes 8+ parallel
 * queries — without caching, that would create 8 separate client
 * instances with 8 separate HTTP connection pools.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment. ' +
      'Check your .env.local file.',
    );
  }

  _client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return _client;
}
