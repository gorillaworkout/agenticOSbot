import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth, requireRole } from '@/lib/auth';
import { ok, err, paginated, parseBody, parseSearchParams } from '@/lib/api';
import { z } from 'zod';

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  try { requireRole(user!, 'ADMIN'); } catch (e) { return e as Response; }

  const { page, pageSize, search } = parseSearchParams(request.url);

  let where = '';
  const params: unknown[] = [];
  let idx = 1;

  if (search) {
    where = `WHERE name ILIKE $1 OR email ILIKE $1`;
    params.push(`%${search}%`);
    idx++;
  }

  const countRow = await getOne<{ count: number }>(
    `SELECT COUNT(*)::int as count FROM users ${where}`, params
  );
  const total = countRow?.count || 0;
  const offset = (page - 1) * pageSize;

  const users = await getMany(
    `SELECT id, email, name, role, avatar_url, settings, created_at, updated_at FROM users ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, pageSize, offset]
  );

  return paginated(users, total, page, pageSize);
}
