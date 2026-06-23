import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { z } from 'zod';

const CreateLarkConfigSchema = z.object({
  appId: z.string().min(1),
  appSecret: z.string().min(1),
  webhookUrl: z.string().url().optional(),
  botName: z.string().optional(),
});

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const configs = await getMany(
    'SELECT id, user_id, app_id, webhook_url, bot_name, enabled, created_at, updated_at FROM lark_config WHERE user_id = $1 ORDER BY created_at DESC',
    [user!.id]
  );
  return ok(configs);
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const body = await parseBody<z.infer<typeof CreateLarkConfigSchema>>(request);
  const parsed = CreateLarkConfigSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  const { appId, appSecret, webhookUrl, botName } = parsed.data;

  const item = await getOne(
    `INSERT INTO lark_config (user_id, app_id, app_secret, webhook_url, bot_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, user_id, app_id, webhook_url, bot_name, enabled, created_at`,
    [user!.id, appId, appSecret, webhookUrl || null, botName || null]
  );

  return ok(item, 201);
}
