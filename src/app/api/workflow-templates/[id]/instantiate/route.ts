import { getOne, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err } from '@/lib/api';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;

  const template = await getOne(
    'SELECT * FROM workflow_templates WHERE id = $1 AND (user_id = $2 OR public = true)',
    [id, user!.id]
  );
  if (!template) return err('Template not found', 404);

  // Create workflow from template
  const workflow = await getOne(
    `INSERT INTO workflows (user_id, name, description, steps) VALUES ($1, $2, $3, $4) RETURNING *`,
    [user!.id, `${template.name} (from template)`, template.description, template.steps]
  );

  // Increment use count
  await query('UPDATE workflow_templates SET use_count = use_count + 1 WHERE id = $1', [id]);

  return ok({ workflow, templateId: id }, 201);
}

export const dynamic = 'force-dynamic';
