import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, paginated, parseBody, parseSearchParams } from '@/lib/api';
import { z } from 'zod';

const CreateTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().default('general'),
  steps: z.array(z.object({
    type: z.enum(['tool_call', 'llm_prompt', 'condition', 'human_approval']),
    name: z.string().optional(),
    config: z.record(z.string(), z.unknown()).default({}),
    dependsOn: z.number().optional(),
    parallel: z.boolean().optional(),
    parallelGroup: z.number().optional(),
    maxRetries: z.number().int().optional(),
    retryDelayMs: z.number().int().optional(),
  })).min(1),
  public: z.boolean().default(false),
});

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { page, pageSize } = parseSearchParams(request.url);
  const countRow = await getOne<{ count: number }>(
    'SELECT COUNT(*)::int as count FROM workflow_templates WHERE user_id = $1 OR public = true', [user!.id]
  );
  const total = countRow?.count || 0;
  const offset = (page - 1) * pageSize;
  const items = await getMany(
    'SELECT * FROM workflow_templates WHERE user_id = $1 OR public = true ORDER BY use_count DESC, created_at DESC LIMIT $2 OFFSET $3',
    [user!.id, pageSize, offset]
  );
  return paginated(items, total, page, pageSize);
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const body = await parseBody<z.infer<typeof CreateTemplateSchema>>(request);
  const parsed = CreateTemplateSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);
  const { name, description, category, steps, public: isPublic } = parsed.data;
  const item = await getOne(
    `INSERT INTO workflow_templates (user_id, name, description, category, steps, public) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [user!.id, name, description || null, category, JSON.stringify(steps), isPublic]
  );
  return ok(item, 201);
}

export const dynamic = 'force-dynamic';
