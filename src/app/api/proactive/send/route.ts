import { NextRequest, NextResponse } from 'next/server';
import { getLarkToken } from '@/lib/lark-api';

export async function POST(req: NextRequest) {
  try {
    const { chatId, message } = await req.json();
    if (!chatId || !message) {
      return NextResponse.json({ error: 'chatId and message required' }, { status: 400 });
    }

    // Send via bot (tenant token) — user can't get bot's own token, but bot can send to any chat
    const token = await getLarkToken();
    const res = await fetch('https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=chat_id', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: message }),
      }),
    });
    const data = await res.json();
    if (data.code !== 0) {
      return NextResponse.json({ error: data.msg, code: data.code }, { status: 500 });
    }
    return NextResponse.json({ ok: true, message_id: data.data?.message_id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
