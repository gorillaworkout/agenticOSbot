import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Protected API routes that require authentication
const PROTECTED_PREFIXES = ['/api/conversations', '/api/agent', '/api/integrations'];
// Public API routes
const PUBLIC_PREFIXES = ['/api/auth', '/api/health'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip non-API routes and public routes
  if (!pathname.startsWith('/api/') || PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check if route needs auth
  const needsAuth = PROTECTED_PREFIXES.some(p => pathname.startsWith(p));
  if (!needsAuth) return NextResponse.next();

  // Verify Authorization header exists
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      { ok: false, error: 'Missing or invalid Authorization header' },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
