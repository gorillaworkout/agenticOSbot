import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { query, getOne } from '@/lib/db';
import { z } from 'zod';

const ConfigSchema = z.object({
  tenantId: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const config = await getOne(
    'SELECT id, tenant_id, client_id, scopes, created_at, updated_at FROM ms365_config WHERE user_id = $1',
    [user!.id]
  );
  if (!config) return ok({ configured: false });
  return ok({ configured: true, ...config });
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const body = await parseBody(request);
  const parsed = ConfigSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message);
  const { tenantId, clientId, clientSecret } = parsed.data;

  // Upsert config
  const existing = await getOne('SELECT id FROM ms365_config WHERE user_id = $1', [user!.id]);
  if (existing) {
    await query(
      'UPDATE ms365_config SET tenant_id = $1, client_id = $2, client_secret_encrypted = $3, updated_at = now() WHERE user_id = $4',
      [tenantId, clientId, clientSecret, user!.id]
    );
  } else {
    await query(
      'INSERT INTO ms365_config (user_id, tenant_id, client_id, client_secret_encrypted) VALUES ($1, $2, $3, $4)',
      [user!.id, tenantId, clientId, clientSecret]
    );
  }
  return ok({ configured: true });
}

export const dynamic = 'force-dynamic';
