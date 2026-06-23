import { getOne, getMany } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, parseSearchParams } from '@/lib/api';

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const url = new URL(request.url);
  const period = url.searchParams.get('period') || '24h';

  let interval: string;
  switch (period) {
    case '7d': interval = '7 days'; break;
    case '30d': interval = '30 days'; break;
    default: interval = '24 hours'; break;
  }

  const bySeverity = await getMany<{ severity: string; count: number }>(
    `SELECT severity, COUNT(*)::int as count FROM error_logs
     WHERE created_at >= now() - interval '${interval}'
     GROUP BY severity ORDER BY count DESC`, []
  );

  const bySource = await getMany<{ source: string; count: number }>(
    `SELECT source, COUNT(*)::int as count FROM error_logs
     WHERE created_at >= now() - interval '${interval}'
     GROUP BY source ORDER BY count DESC`, []
  );

  const total = await getOne<{ count: number }>(
    `SELECT COUNT(*)::int as count FROM error_logs WHERE created_at >= now() - interval '${interval}'`, []
  );

  const unresolved = await getOne<{ count: number }>(
    `SELECT COUNT(*)::int as count FROM error_logs WHERE resolved = false AND created_at >= now() - interval '${interval}'`, []
  );

  return ok({
    period,
    total: total?.count || 0,
    unresolved: unresolved?.count || 0,
    bySeverity,
    bySource,
  });
}

export const dynamic = 'force-dynamic';
