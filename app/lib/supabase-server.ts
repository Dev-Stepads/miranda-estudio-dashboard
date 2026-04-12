/**
 * Supabase client for Next.js Server Components.
 *
 * Uses the service_role key which bypasses RLS. This is safe because
 * Server Components run ONLY on the server — the key never reaches
 * the browser. The dashboard is internal (no public API exposed).
 *
 * Reads from process.env which Next.js populates from .env.local.
 */

import { createClient } from '@supabase/supabase-js';

export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment. ' +
      'Check your .env.local file.',
    );
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
