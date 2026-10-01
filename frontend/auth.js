import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';

const backend = process.env.BACKEND_URL || 'http://localhost:4000';

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 14 },
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === 'production' ? '__Secure-authjs.session-token' : 'authjs.session-token',
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' }
    }
  },
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? [Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })] : []),
    Credentials({
      id: 'credentials',
      name: 'Username or email',
      credentials: { identifier: { label: 'Username or email', type: 'text' }, password: { label: 'Password', type: 'password' } },
      async authorize(credentials) {
        const response = await fetch(`${backend}/api/auth/login`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ identifier: credentials?.identifier, password: credentials?.password }), cache: 'no-store'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.data?.user) return null;
        return { ...payload.data.user, name: payload.data.user.profile?.displayName || payload.data.user.username };
      }
    })
  ],
  callbacks: {
    authorized({ auth }) { return Boolean(auth?.user); },
    async jwt({ token, user, account }) {
      if (user && account?.provider === 'credentials') { token.sub = user.id; token.username = user.username; }
      if (user && account?.provider === 'google') {
        const response = await fetch(`${backend}/api/auth/google-sync`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-auth': process.env.INTERNAL_AUTH_SECRET || '' },
          body: JSON.stringify({ email: user.email, name: user.name, image: user.image }), cache: 'no-store'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.data?.user?.id) throw new Error('Google account could not be connected to the app account.');
        token.sub = payload.data.user.id;
        token.username = payload.data.user.username;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) { session.user.id = token.sub; session.user.username = token.username; }
      return session;
    }
  },
  pages: { signIn: '/login' }
});
