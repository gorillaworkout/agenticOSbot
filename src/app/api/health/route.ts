import { NextResponse } from 'next/server';
import { getOne } from '@/lib/db';

export async function GET() {
  try {
    const stats = await getOne(`
      SELECT
        (SELECT count(*) FROM users) as users,
        (SELECT count(*) FROM conversations) as conversations,
        (SELECT count(*) FROM tools) as tools,
        (SELECT count(*) FROM messages) as messages
    `);

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      database: 'connected',
      stats: {
        users: Number(stats?.users || 0),
        conversations: Number(stats?.conversations || 0),
        tools: Number(stats?.tools || 0),
        messages: Number(stats?.messages || 0),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { status: 'error', database: 'disconnected', error: String(error) },
      { status: 503 }
    );
  }
}
