import { ok, err } from '@/lib/api';
import { query, getOne } from '@/lib/db';
import { childLogger } from '@/lib/logger';

const log = childLogger('oauth:lark');

// GET /api/lark/oauth/callback — handles OAuth redirect from Lark
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    // No code/state — might be a direct visit or Lark redirect with error
    const error = url.searchParams.get('error');
    return new Response(
      `<html><body style="font-family:sans-serif;text-align:center;padding:50px">
        <h1>❌ Authorization failed</h1>
        <p>${error || 'Missing authorization code'}</p>
        <p style="margin-top:20px"><a href="/bots" style="color:#6366f1">← Back to Bot Manager</a></p>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }

  // Look up state in DB (created by /api/lark/authorize)
  const pending = await getOne<{ app_id: string; redirect_uri: string }>(
    'SELECT app_id, redirect_uri FROM oauth_states WHERE state = $1 AND expires_at > now()',
    [state]
  );
  if (!pending) {
    return new Response(
      `<html><body style="font-family:sans-serif;text-align:center;padding:50px">
        <h1>❌ Invalid or expired authorization</h1>
        <p>Please try again from the Bot Manager.</p>
        <p style="margin-top:20px"><a href="/bots" style="color:#6366f1">← Back to Bot Manager</a></p>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }

  // Delete used state
  await query('DELETE FROM oauth_states WHERE state = $1', [state]);

  const config = await getOne<{ app_id: string; app_secret: string }>(
    'SELECT app_id, app_secret FROM lark_config WHERE app_id = $1',
    [pending.app_id]
  );
  if (!config) {
    return new Response(
      `<html><body style="font-family:sans-serif;text-align:center;padding:50px">
        <h1>❌ Lark app not found</h1>
        <p style="margin-top:20px"><a href="/bots" style="color:#6366f1">← Back to Bot Manager</a></p>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }

  try {
    const LARK_BASE = 'https://open.larksuite.com/open-apis';
    const tokenRes = await fetch(`${LARK_BASE}/authen/v2/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.app_id,
        client_secret: config.app_secret,
        code,
        redirect_uri: pending.redirect_uri,
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.code !== 0) throw new Error(tokenData.msg || 'Token exchange failed');

    const { access_token, refresh_token, expires_in, scope } = tokenData.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Fetch actual user name from Lark
    let userName = 'User';
    try {
      const userRes = await fetch(`${LARK_BASE}/authen/v1/user_info`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const userData = await userRes.json();
      if (userData.code === 0) {
        userName = userData.data?.name || userData.data?.localized_name || 'User';
      }
    } catch {}

    // Store token in DB
    await query(
      `INSERT INTO lark_user_tokens (user_id, app_id, access_token, refresh_token, expires_at, scopes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, app_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         scopes = EXCLUDED.scopes,
         updated_at = now()`,
      [userName, pending.app_id, access_token, refresh_token, expiresAt, scope?.split(' ')]
    );

    log.info({ appId: pending.app_id, userName }, 'Lark OAuth token stored');

    return Response.redirect('/bots?auth=success', 302);
  } catch (e) {
    log.error({ err: e }, 'Token exchange failed');
    return new Response(
      `<html><body style="font-family:sans-serif;text-align:center;padding:50px">
        <h1>❌ Token exchange failed</h1>
        <p>${String(e)}</p>
        <p style="margin-top:20px"><a href="/bots" style="color:#6366f1">← Back to Bot Manager</a></p>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}
