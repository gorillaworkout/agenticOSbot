import { getOne, getMany } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, parseSearchParams } from '@/lib/api';

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const aggregation = url.searchParams.get('agg') || 'avg'; // avg/count/min/max/sum

  if (!name) return ok([]);

  let where = 'WHERE metric_name = $1';
  const params: unknown[] = [name];
  let idx = 2;

  if (from) { where += ` AND recorded_at >= $${idx++}`; params.push(from); }
  if (to) { where += ` AND recorded_at <= $${idx++}`; params.push(to); }

  const aggFn = ['avg', 'count', 'min', 'max', 'sum'].includes(aggregation) ? aggregation : 'avg';
  const fnMap: Record<string, string> = { avg: 'AVG', count: 'COUNT(*)', min: 'MIN', max: 'MAX', sum: 'SUM' };

  const result = await getOne<{ value: number }>(
    `SELECT ${fnMap[aggFn]}(metric_value)::numeric as value FROM metrics ${where}`,
    params
  );

  // Also get per-hour breakdown for the last 24h
  const hourly = await getMany<{ hour: string; value: number }>(
    `SELECT date_trunc('hour', recorded_at) as hour, ${fnMap[aggFn]}(metric_value)::numeric as value
     FROM metrics ${where} AND recorded_at >= now() - interval '24 hours'
     GROUP BY date_trunc('hour', recorded_at) ORDER BY hour`,
    params
  );

  return ok({
    metric: name,
    aggregation,
    value: result?.value || 0,
    hourly,
  });
}

export const dynamic = 'force-dynamic';
