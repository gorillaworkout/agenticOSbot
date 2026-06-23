import { authenticateRequest, requireAuth, verifyPassword, hashPassword } from '@/lib/auth';
import { getOne } from '@/lib/db';
import { ok, err, parseBody } from '@/lib/api';
import { z } from 'zod';

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const body = await parseBody<z.infer<typeof ChangePasswordSchema>>(request);
  const parsed = ChangePasswordSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  const dbUser = await getOne<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE id = $1', [user!.id]
  );
  if (!dbUser) return err('User not found', 404);

  const valid = await verifyPassword(parsed.data.currentPassword, dbUser.password_hash);
  if (!valid) return err('Current password is incorrect', 400);

  const newHash = await hashPassword(parsed.data.newPassword);
  await getOne(
    'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2 RETURNING id',
    [newHash, user!.id]
  );

  return ok({ message: 'Password changed successfully' });
}
