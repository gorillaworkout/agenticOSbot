import { getOne, getMany } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, paginated, parseSearchParams } from '@/lib/api';

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const url = new URL(request.url);
  const { page, pageSize } = parseSearchParams(request.url);
  const severity = url.searchParams.get('severity');
  const source = url.searchParams.get('source');
  const resolved = url.searchParams.get('resolved');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let idx = 1;

  if (severity) { where += ` AND severity = $${idx++}`; params.push(severity); }
  if (source) { where += ` AND source = $${idx++}`; params.push(source); }
  if (resolved !== null && resolved !== undefined) { where += ` AND resolved = $${idx++}`; params.push(resolved === 'true'); }
  if (from) { where += ` AND created_at >= $${idx++}`; params.push(from); }
  if (to) { where += ` AND created_at <= $${idx++}`; params.push(to); }

  const countRow = await getOne<{ count: number }>(`SELECT COUNT(*)::int as count FROM error_logs ${where}`, params);
  const total = countRow?.count || 0;
  const offset = (page - 1) * pageSize;

  const items = await getMany(
    `SELECT * FROM error_logs ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, pageSize, offset]
  );

  return paginated(items, total, page, pageSize);
}

export const dynamic = 'force-dynamic';
