import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, paginated, parseBody, parseSearchParams } from '@/lib/api';
import { z } from 'zod';

const CreateWorkflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(z.object({
    type: z.enum(['tool_call', 'llm_prompt', 'condition', 'human_approval']),
    name: z.string().optional(),
    config: z.record(z.string(), z.unknown()).default({}),
    dependsOn: z.number().optional(), // step index
  })).min(1),
});

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const { page, pageSize } = parseSearchParams(request.url);

  const countRow = await getOne<{ count: number }>(
    'SELECT COUNT(*)::int as count FROM workflows WHERE user_id = $1', [user!.id]
  );
  const total = countRow?.count || 0;
  const offset = (page - 1) * pageSize;

  const items = await getMany(
    'SELECT * FROM workflows WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [user!.id, pageSize, offset]
  );

  return paginated(items, total, page, pageSize);
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const body = await parseBody<z.infer<typeof CreateWorkflowSchema>>(request);
  const parsed = CreateWorkflowSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  const { name, description, steps } = parsed.data;

  const item = await getOne(
    `INSERT INTO workflows (user_id, name, description, steps)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [user!.id, name, description || null, JSON.stringify(steps)]
  );

  return ok(item, 201);
}
