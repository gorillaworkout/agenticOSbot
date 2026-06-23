import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, paginated, parseBody, parseSearchParams } from '@/lib/api';
import { logMetric } from '@/lib/errors';
import { z } from 'zod';

const RecordMetricSchema = z.object({
  name: z.string().min(1),
  value: z.number(),
  labels: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const url = new URL(request.url);
  const { page, pageSize } = parseSearchParams(request.url);
  const name = url.searchParams.get('name');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let idx = 1;

  if (name) { where += ` AND metric_name = $${idx++}`; params.push(name); }
  if (from) { where += ` AND recorded_at >= $${idx++}`; params.push(from); }
  if (to) { where += ` AND recorded_at <= $${idx++}`; params.push(to); }

  const countRow = await getOne<{ count: number }>(`SELECT COUNT(*)::int as count FROM metrics ${where}`, params);
  const total = countRow?.count || 0;
  const offset = (page - 1) * pageSize;

  const items = await getMany(
    `SELECT * FROM metrics ${where} ORDER BY recorded_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, pageSize, offset]
  );

  return paginated(items, total, page, pageSize);
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const body = await parseBody<z.infer<typeof RecordMetricSchema>>(request);
  const parsed = RecordMetricSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  await logMetric(parsed.data.name, parsed.data.value, parsed.data.labels);
  return ok({ recorded: true });
}

export const dynamic = 'force-dynamic';
