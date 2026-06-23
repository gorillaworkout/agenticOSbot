import { getMany, getOne, query } from '@/lib/db';
import { authenticateRequest, requireAuth, requireRole } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { z } from 'zod';

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const tools = await getMany(
    'SELECT id, name, description, schema, enabled, created_at FROM tools ORDER BY name'
  );

  return ok(tools);
}

const ToggleSchema = z.object({
  name: z.string(),
  enabled: z.boolean(),
});

export async function PATCH(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  try { requireRole(user!, 'ADMIN'); } catch (e) { return e as Response; }

  const body = await parseBody<z.infer<typeof ToggleSchema>>(request);
  const parsed = ToggleSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  const updated = await getOne(
    'UPDATE tools SET enabled = $1, updated_at = now() WHERE name = $2 RETURNING *',
    [parsed.data.enabled, parsed.data.name]
  );

  if (!updated) return err('Tool not found', 404);
  return ok(updated);
}
