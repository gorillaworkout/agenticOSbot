/**
 * GOR-109: NextAuth.js API route handler.
 */
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { getOne, query } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';

const handler = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    }),
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await getOne<{ id: string; email: string; name: string; password_hash: string; role: string }>(
          'SELECT id, email, name, password_hash, role FROM users WHERE email = $1',
          [credentials.email as string]
        );
        if (!user || !user.password_hash) return null;
        const isValid = await verifyPassword(credentials.password as string, user.password_hash);
        if (!isValid) return null;
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'google') {
        const existing = await getOne<{ id: string }>('SELECT id FROM users WHERE email = $1', [user.email!]);
        if (!existing) {
          await query(
            'INSERT INTO users (email, name, role, metadata) VALUES ($1, $2, $3, $4)',
            [user.email, user.name || 'User', 'user', JSON.stringify({ provider: 'google', picture: user.image })]
          );
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        const dbUser = await getOne<{ id: string; role: string }>('SELECT id, role FROM users WHERE email = $1', [user.email!]);
        if (dbUser) {
          (token as Record<string, unknown>).userId = dbUser.id;
          (token as Record<string, unknown>).role = dbUser.role;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as Record<string, unknown>).userId = (token as Record<string, unknown>).userId;
        (session.user as Record<string, unknown>).role = (token as Record<string, unknown>).role;
      }
      return session;
    },
  },
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET,
});

export { handler as GET, handler as POST };
