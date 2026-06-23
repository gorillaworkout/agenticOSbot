import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, paginated, parseBody, parseSearchParams } from '@/lib/api';
import { z } from 'zod';

const CreatePluginSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().default('1.0.0'),
  pluginType: z.enum(['tool_provider', 'webhook_handler', 'ui_component', 'scheduler']),
  config: z.record(z.string(), z.unknown()).default({}),
  manifest: z.record(z.string(), z.unknown()).default({}),
});

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { page, pageSize } = parseSearchParams(request.url);
  const countRow = await getOne<{ count: number }>('SELECT COUNT(*)::int as count FROM plugins WHERE user_id = $1', [user!.id]);
  const total = countRow?.count || 0;
  const offset = (page - 1) * pageSize;
  const items = await getMany('SELECT * FROM plugins WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [user!.id, pageSize, offset]);
  return paginated(items, total, page, pageSize);
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const body = await parseBody<z.infer<typeof CreatePluginSchema>>(request);
  const parsed = CreatePluginSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);
  const { name, description, version, pluginType, config, manifest } = parsed.data;
  const item = await getOne(
    `INSERT INTO plugins (user_id, name, description, version, plugin_type, config, manifest) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [user!.id, name, description || null, version, pluginType, JSON.stringify(config), JSON.stringify(manifest)]
  );
  return ok(item, 201);
}

export const dynamic = 'force-dynamic';
