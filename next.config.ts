import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Supabase service_role key stays server-side only.
  // NEVER prefix with NEXT_PUBLIC_.
  serverExternalPackages: ['@supabase/supabase-js'],

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
