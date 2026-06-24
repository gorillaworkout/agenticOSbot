/**
 * GOR-138: OAuth callback route.
 * Handles the redirect from OAuth providers after user authorizes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { parseOAuthState, exchangeCode, saveConnection, OAUTH_PROVIDERS } from '@/lib/oauth';
import { childLogger } from '@/lib/logger';

const log = childLogger('oauth:callback');

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const error = req.nextUrl.searchParams.get('error');

  if (error) {
    log.error({ error }, 'OAuth error from provider');
    return NextResponse.redirect(new URL(`/integrations?error=${encodeURIComponent(error)}`, req.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/integrations?error=missing_code_or_state', req.url));
  }

  const { userId, provider, error: stateError } = parseOAuthState(state);
  if (stateError || !userId || !provider) {
    return NextResponse.redirect(new URL(`/integrations?error=${encodeURIComponent(stateError || 'invalid_state')}`, req.url));
  }

  const config = OAUTH_PROVIDERS[provider];
  if (!config) {
    return NextResponse.redirect(new URL('/integrations?error=unknown_provider', req.url));
  }

  const clientId = process.env[`${provider.toUpperCase()}_CLIENT_ID`] || '';
  const clientSecret = process.env[`${provider.toUpperCase()}_CLIENT_SECRET`] || '';

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/integrations?error=provider_not_configured', req.url));
  }

  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  const redirectUri = `${baseUrl}/api/oauth/callback`;

  const tokens = await exchangeCode(provider, code, clientId, clientSecret, redirectUri);

  if (tokens.error || !tokens.accessToken) {
    log.error({ provider, error: tokens.error }, 'Token exchange failed');
    return NextResponse.redirect(new URL(`/integrations?error=${encodeURIComponent(tokens.error || 'token_exchange_failed')}`, req.url));
  }

  // Try to get user info from provider
  let providerUser: { id: string; name: string } | undefined;
  try {
    if (provider === 'github') {
      const userRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/vnd.github.v3+json' },
      });
      const userData = await userRes.json();
      providerUser = { id: String(userData.id), name: userData.login };
    } else if (provider === 'notion') {
      const userRes = await fetch('https://api.notion.com/v1/users/me', {
        headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Notion-Version': '2022-06-28' },
      });
      const userData = await userRes.json();
      providerUser = { id: userData.id, name: userData.name || userData.bot?.workspace?.name || 'Notion User' };
    } else if (provider === 'slack') {
      const userRes = await fetch('https://slack.com/api/auth.test', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      const userData = await userRes.json();
      if (userData.ok) providerUser = { id: userData.user_id, name: userData.user };
    }
  } catch {
    // Non-fatal — we can still save the connection
    log.warn({ provider }, 'Could not fetch provider user info');
  }

  await saveConnection(userId, provider, tokens, providerUser);

  log.info({ userId, provider, providerUser: providerUser?.name }, 'OAuth connection established');
  return NextResponse.redirect(new URL(`/integrations?connected=${provider}`, req.url));
}
