import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, paginated, parseBody, parseSearchParams } from '@/lib/api';
import { z } from 'zod';

const CreateReportSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  reportType: z.enum(['usage', 'activity', 'performance', 'custom']),
  config: z.record(z.string(), z.unknown()).default({}),
  schedule: z.string().nullable().optional(),
});

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const { page, pageSize } = parseSearchParams(request.url);
  const countRow = await getOne<{ count: number }>(
    'SELECT COUNT(*)::int as count FROM reports WHERE user_id = $1', [user!.id]
  );
  const total = countRow?.count || 0;
  const offset = (page - 1) * pageSize;

  const items = await getMany(
    'SELECT * FROM reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [user!.id, pageSize, offset]
  );

  return paginated(items, total, page, pageSize);
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const body = await parseBody<z.infer<typeof CreateReportSchema>>(request);
  const parsed = CreateReportSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  const { name, description, reportType, config, schedule } = parsed.data;

  const item = await getOne(
    `INSERT INTO reports (user_id, name, description, report_type, config, schedule)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [user!.id, name, description || null, reportType, JSON.stringify(config), schedule ?? null]
  );

  return ok(item, 201);
}

export const dynamic = 'force-dynamic';
