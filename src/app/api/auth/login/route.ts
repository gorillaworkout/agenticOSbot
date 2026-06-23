import { verifyPassword, generateToken } from '@/lib/auth';
import { getOne } from '@/lib/db';
import { ok, err, parseBody } from '@/lib/api';
import { z } from 'zod';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  password_hash: string;
}

export async function POST(request: Request) {
  try {
    const body = await parseBody<z.infer<typeof LoginSchema>>(request);
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) return err(parsed.error.issues[0].message, 400);

    const { email, password } = parsed.data;

    const user = await getOne<UserRow>(
      'SELECT id, email, name, role, password_hash FROM users WHERE email = $1',
      [email]
    );
    if (!user) return err('Invalid credentials', 401);

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return err('Invalid credentials', 401);

    const token = generateToken(user.id);
    const { password_hash: _, ...safeUser } = user;

    return ok({ user: safeUser, token });
  } catch (e) {
    if (e instanceof Response) return e;
    return err('Login failed', 500);
  }
}
