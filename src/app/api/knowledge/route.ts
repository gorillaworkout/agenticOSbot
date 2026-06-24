import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, paginated, parseBody, parseSearchParams } from '@/lib/api';
import { createVaultNote } from '@/lib/vault';
import { z } from 'zod';

const CreateKBSchema = z.object({
  sourceType: z.enum(['conversation', 'note', 'document', 'web']),
  sourceId: z.string().optional(),
  title: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const { page, pageSize, search } = parseSearchParams(request.url);
  const offset = (page - 1) * pageSize;
  const url = new URL(request.url);
  const tag = url.searchParams.get('tag');
  const sourceType = url.searchParams.get('type');

  let where = 'WHERE user_id = $1';
  const params: unknown[] = [user!.id];
  let idx = 2;

  if (search) {
    where += ` AND (title ILIKE $${idx} OR content ILIKE $${idx})`;
    params.push(`%${search}%`);
    idx++;
  }
  if (tag) {
    where += ` AND $${idx} = ANY(tags)`;
    params.push(tag);
    idx++;
  }
  if (sourceType) {
    where += ` AND source_type = $${idx}`;
    params.push(sourceType);
    idx++;
  }

  const countRow = await getOne<{ count: number }>(
    `SELECT COUNT(*)::int as count FROM knowledge_notes ${where}`, params
  );
  const total = countRow?.count || 0;

  const items = await getMany(
    `SELECT * FROM knowledge_notes ${where} ORDER BY updated_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, pageSize, offset]
  );

  return paginated(items, total, page, pageSize);
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const body = await parseBody<z.infer<typeof CreateKBSchema>>(request);
  const parsed = CreateKBSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  const item = await createVaultNote(
    user!.id,
    parsed.data.title,
    parsed.data.content,
    parsed.data.tags || [],
    parsed.data.sourceType,
    parsed.data.metadata || {}
  );

  return ok(item, 201);
}
