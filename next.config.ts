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
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.fbcdn.net; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
