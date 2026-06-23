import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, paginated, parseBody, parseSearchParams } from '@/lib/api';
import { z } from 'zod';

const CreateConversationSchema = z.object({
  title: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const { page, pageSize, search } = parseSearchParams(request.url);
  const offset = (page - 1) * pageSize;

  let countSql = 'SELECT COUNT(*)::int as count FROM conversations WHERE user_id = $1 AND archived = false';
  let dataSql = `
    SELECT c.id, c.title, c.metadata, c.created_at, c.updated_at,
      (SELECT COUNT(*)::int FROM messages WHERE conversation_id = c.id) as message_count,
      (SELECT json_build_object('content', m.content, 'role', m.role)
       FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message
    FROM conversations c
    WHERE c.user_id = $1 AND c.archived = false
  `;
  const params: unknown[] = [user!.id];

  if (search) {
    countSql += ' AND title ILIKE $2';
    dataSql += ' AND c.title ILIKE $2';
    params.push(`%${search}%`);
  }

  dataSql += ' ORDER BY c.updated_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);

  const countRow = await getOne<{ count: number }>(countSql, search ? params : [user!.id]);
  const total = countRow?.count || 0;

  const conversations = await getMany(dataSql, [...params, pageSize, offset]);

  return paginated(conversations, total, page, pageSize);
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  try {
    const body = await parseBody<z.infer<typeof CreateConversationSchema>>(request);
    const parsed = CreateConversationSchema.safeParse(body);
    if (!parsed.success) return err(parsed.error.issues[0].message, 400);

    const conversation = await getOne(
      `INSERT INTO conversations (user_id, title, metadata)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [user!.id, parsed.data.title || null, JSON.stringify(parsed.data.metadata || {})]
    );

    return ok(conversation, 201);
  } catch (e) {
    if (e instanceof Response) return e;
    return err('Failed to create conversation', 500);
  }
}
