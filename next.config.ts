import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Supabase service_role key stays server-side only.
  // NEVER prefix with NEXT_PUBLIC_.
  serverExternalPackages: ['@supabase/supabase-js'],
};

export default nextConfig;
