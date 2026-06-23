import { NextResponse } from 'next/server';

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function err(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export function paginated<T>(data: T[], total: number, page: number, pageSize: number) {
  return NextResponse.json({
    ok: true,
    data,
    pagination: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  });
}

export async function parseBody<T>(request: Request): Promise<T> {
  try {
    return await request.json();
  } catch {
    throw new Response(JSON.stringify({ ok: false, error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export function parseSearchParams(url: string) {
  const u = new URL(url);
  return {
    page: parseInt(u.searchParams.get('page') || '1'),
    pageSize: Math.min(parseInt(u.searchParams.get('pageSize') || '20'), 100),
    search: u.searchParams.get('search') || undefined,
    sort: u.searchParams.get('sort') || undefined,
    order: (u.searchParams.get('order') || 'desc') as 'asc' | 'desc',
  };
}
