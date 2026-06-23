import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, paginated, parseBody, parseSearchParams } from '@/lib/api';
import { z } from 'zod';

const CreateAlertSchema = z.object({
  name: z.string().min(1),
  metricName: z.string().min(1),
  condition: z.enum(['gt', 'lt', 'eq', 'gte', 'lte']),
  threshold: z.number(),
  windowMinutes: z.number().int().min(1).default(5),
  enabled: z.boolean().default(true),
});

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const { page, pageSize } = parseSearchParams(request.url);
  const countRow = await getOne<{ count: number }>(
    'SELECT COUNT(*)::int as count FROM alerts WHERE user_id = $1', [user!.id]
  );
  const total = countRow?.count || 0;
  const offset = (page - 1) * pageSize;

  const items = await getMany(
    'SELECT * FROM alerts WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [user!.id, pageSize, offset]
  );

  return paginated(items, total, page, pageSize);
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const body = await parseBody<z.infer<typeof CreateAlertSchema>>(request);
  const parsed = CreateAlertSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  const { name, metricName, condition, threshold, windowMinutes, enabled } = parsed.data;

  const item = await getOne(
    `INSERT INTO alerts (user_id, name, metric_name, condition, threshold, window_minutes, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [user!.id, name, metricName, condition, threshold, windowMinutes, enabled]
  );

  return ok(item, 201);
}

export const dynamic = 'force-dynamic';
