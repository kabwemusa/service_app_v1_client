import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // API calls go to the Laravel backend; proxy in dev to avoid CORS
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'}/api/:path*`,
      },
    ]
  },
}

export default config
