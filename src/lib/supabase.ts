/**
 * Supabase client factory.
 *
 * Creates a typed client using the service_role key, which bypasses
 * RLS (Row-Level Security). This is the ONLY way the ETL can write
 * to the canonical tables — anon/authenticated are default-deny.
 *
 * Usage:
 *   const supabase = createSupabaseClient({
 *     url: process.env.SUPABASE_URL!,
 *     serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
 *   });
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
}

/**
 * Create a Supabase admin client with service_role privileges.
 *
 * ⚠ The service_role key gives FULL access to ALL tables, bypassing
 * RLS. Never expose this key to the client/browser. It should only
 * be used in server-side ETL code.
 */
export function createSupabaseAdmin(config: SupabaseConfig): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
