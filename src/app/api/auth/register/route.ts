import { hashPassword, generateToken } from '@/lib/auth';
import { getOne } from '@/lib/db';
import { ok, err, parseBody } from '@/lib/api';
import { z } from 'zod';

const RegisterSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  try {
    const body = await parseBody<z.infer<typeof RegisterSchema>>(request);
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) return err(parsed.error.issues[0].message, 400);

    const { email, name, password } = parsed.data;

    const existing = await getOne('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) return err('Email already registered', 409);

    const passwordHash = await hashPassword(password);
    const user = await getOne(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1, $2, $3, 'USER')
       RETURNING id, email, name, role, created_at`,
      [email, name, passwordHash]
    );

    if (!user) return err('Registration failed', 500);

    const token = generateToken(user.id as string);
    return ok({ user, token }, 201);
  } catch (e) {
    if (e instanceof Response) return e;
    return err('Registration failed', 500);
  }
}
