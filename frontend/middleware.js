export { auth as middleware } from './auth';

export const config = {
  matcher: ['/messages/:path*', '/settings/:path*'],
  runtime: 'nodejs'
};
