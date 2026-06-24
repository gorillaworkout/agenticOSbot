/**
 * GOR-109: NextAuth.js Google OAuth integration.
 * Separate from existing JWT auth — used for OAuth flow only.
 * Config is in the route handler; this file exports helpers.
 */
import { getOne, query } from './db';

/**
 * Ensure a Google-authenticated user exists in the DB.
 */
export async function ensureGoogleUser(email: string, name: string, image?: string): Promise<string> {
  const existing = await getOne<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) return existing.id;
  const result = await query<{ id: string }>(
    'INSERT INTO users (email, name, role, metadata) VALUES ($1, $2, $3, $4) RETURNING id',
    [email, name || 'User', 'user', JSON.stringify({ provider: 'google', picture: image })]
  );
  return result.rows[0].id;
}
