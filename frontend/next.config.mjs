/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  output: 'standalone',
  experimental: { serverActions: { bodySizeLimit: '15mb' } }
};

export default nextConfig;
