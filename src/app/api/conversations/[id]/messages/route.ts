import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody, paginated, parseSearchParams } from '@/lib/api';
import { z } from 'zod';

const MessageRole = z.enum(['USER', 'ASSISTANT', 'SYSTEM', 'TOOL']);

const CreateMessageSchema = z.object({
  role: MessageRole,
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const { id } = await params;
  const { page, pageSize } = parseSearchParams(request.url);
  const offset = (page - 1) * pageSize;

  // Verify conversation ownership
  const conversation = await getOne(
    'SELECT id FROM conversations WHERE id = $1 AND user_id = $2',
    [id, user!.id]
  );
  if (!conversation) return err('Conversation not found', 404);

  const countRow = await getOne<{ count: number }>(
    'SELECT COUNT(*)::int as count FROM messages WHERE conversation_id = $1',
    [id]
  );
  const total = countRow?.count || 0;

  const messages = await getMany(
    'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3',
    [id, pageSize, offset]
  );

  return paginated(messages, total, page, pageSize);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const { id } = await params;

  // Verify conversation ownership
  const conversation = await getOne(
    'SELECT id FROM conversations WHERE id = $1 AND user_id = $2',
    [id, user!.id]
  );
  if (!conversation) return err('Conversation not found', 404);

  try {
    const body = await parseBody<z.infer<typeof CreateMessageSchema>>(request);
    const parsed = CreateMessageSchema.safeParse(body);
    if (!parsed.success) return err(parsed.error.issues[0].message, 400);

    const message = await getOne(
      `INSERT INTO messages (conversation_id, role, content, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, parsed.data.role, parsed.data.content, JSON.stringify(parsed.data.metadata || {})]
    );

    // Touch conversation to update updated_at
    await query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [id]);

    return ok(message, 201);
  } catch (e) {
    if (e instanceof Response) return e;
    return err('Failed to create message', 500);
  }
}
