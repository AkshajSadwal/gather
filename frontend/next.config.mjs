/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: '15mb' } }
};

export default nextConfig;
