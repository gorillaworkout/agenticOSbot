import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { z } from 'zod';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;

  const agg = await getOne<{ id: string; source_table: string; group_by_fields: string[]; aggregations: Record<string, string>; filter: Record<string, unknown> }>(
    'SELECT * FROM aggregations WHERE id = $1 AND user_id = $2', [id, user!.id]
  );
  if (!agg) return err('Aggregation not found', 404);

  try {
    // Build dynamic SQL
    const selectParts: string[] = [];
    for (const [field, fn] of Object.entries(agg.aggregations)) {
      const sqlFn = ['sum', 'avg', 'count', 'min', 'max'].includes(fn) ? fn : 'count';
      selectParts.push(`${sqlFn}(${field}) as ${fn}_${field}`);
    }

    const groupBy = agg.group_by_fields.length > 0
      ? `GROUP BY ${agg.group_by_fields.map(f => `"${f}"`).join(', ')}`
      : '';

    // Simple WHERE clause from filter
    let where = '';
    const whereParams: unknown[] = [];
    let wIdx = 1;
    for (const [k, v] of Object.entries(agg.filter)) {
      if (where) where += ' AND';
      where += ` "${k}" = $${wIdx++}`;
      whereParams.push(v);
    }
    if (where) where = 'WHERE ' + where;

    const sql = `SELECT ${selectParts.join(', ')} FROM "${agg.source_table}" ${where} ${groupBy}`;
    const result = await getMany(sql, whereParams);

    // Store result
    await query('UPDATE aggregations SET result = $1, last_run_at = now() WHERE id = $2', [JSON.stringify(result), id]);

    return ok({ aggregationId: id, result, rowCount: result.length });
  } catch (e) {
    return err(`Aggregation failed: ${String(e)}`, 500);
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;
  const agg = await getOne('SELECT id, result, last_run_at FROM aggregations WHERE id = $1 AND user_id = $2', [id, user!.id]);
  if (!agg) return err('Aggregation not found', 404);
  return ok({ id: agg.id, result: agg.result, lastRunAt: agg.last_run_at });
}

export const dynamic = 'force-dynamic';
