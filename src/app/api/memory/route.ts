import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { z } from 'zod';

const GetMemorySchema = z.object({
  namespace: z.string().optional(),
  key: z.string().optional(),
});

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const url = new URL(request.url);
  const namespace = url.searchParams.get('namespace') || 'default';
  const key = url.searchParams.get('key');

  if (key) {
    const item = await getOne(
      'SELECT * FROM agent_memory WHERE user_id = $1 AND namespace = $2 AND key = $3',
      [user!.id, namespace, key]
    );
    if (!item) return err('Memory not found', 404);
    return ok(item);
  }

  const items = await getMany(
    'SELECT * FROM agent_memory WHERE user_id = $1 AND namespace = $2 ORDER BY updated_at DESC LIMIT 100',
    [user!.id, namespace]
  );
  return ok(items);
}

const SetMemorySchema = z.object({
  namespace: z.string().optional(),
  key: z.string().min(1),
  value: z.unknown(),
  expiresAt: z.string().datetime().optional(),
});

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const body = await parseBody<z.infer<typeof SetMemorySchema>>(request);
  const parsed = SetMemorySchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  const ns = parsed.data.namespace || 'default';
  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;

  const item = await getOne(
    `INSERT INTO agent_memory (user_id, namespace, key, value, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, namespace, key)
     DO UPDATE SET value = $4, expires_at = $5, updated_at = now()
     RETURNING *`,
    [user!.id, ns, parsed.data.key, JSON.stringify(parsed.data.value), expiresAt]
  );

  return ok(item, 201);
}

export async function DELETE(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const url = new URL(request.url);
  const namespace = url.searchParams.get('namespace') || 'default';
  const key = url.searchParams.get('key');

  if (!key) return err('Key required', 400);

  await query(
    'DELETE FROM agent_memory WHERE user_id = $1 AND namespace = $2 AND key = $3',
    [user!.id, namespace, key]
  );

  return ok({ deleted: true });
}
