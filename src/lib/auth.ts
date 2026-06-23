import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getOne } from './db';

const JWT_SECRET = process.env.JWT_SECRET || 'agentic-os-dev-secret';
const TOKEN_EXPIRY = '7d';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): { sub: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { sub: string };
  } catch {
    return null;
  }
}

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export async function authenticateRequest(request: Request): Promise<AuthUser | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) return null;

  const user = await getOne<AuthUser>(
    'SELECT id, email, name, role FROM users WHERE id = $1',
    [payload.sub]
  );

  return user;
}

export function requireAuth(user: AuthUser | null) {
  if (!user) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return user;
}

export function requireRole(user: AuthUser, role: string | string[]) {
  const roles = Array.isArray(role) ? role : [role];
  if (!roles.includes(user.role)) {
    throw new Response(JSON.stringify({ error: `Forbidden: requires role ${roles.join(' or ')}` }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
