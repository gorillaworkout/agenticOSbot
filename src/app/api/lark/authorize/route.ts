import { err } from '@/lib/api';
import { getOne, query } from '@/lib/db';
import { childLogger } from '@/lib/logger';
import crypto from 'crypto';

const log = childLogger('api:lark:authorize');

export async function GET(request: Request) {
  const url = new URL(request.url);
  const appId = url.searchParams.get('appId');
  if (!appId) return err('appId required', 400);

  const config = await getOne<{ app_id: string; app_secret: string }>(
    'SELECT app_id, app_secret FROM lark_config WHERE app_id = $1 AND enabled = true',
    [appId]
  );
  if (!config) return err('Lark app not configured. Register the bot first.', 404);

  const state = crypto.randomBytes(16).toString('hex');
  const REDIRECT_URI = process.env.LARK_OAUTH_REDIRECT_URI || 'https://agentic.gorillaworkout.id/api/lark/oauth/callback';

  // Store state in DB so callback can verify
  await query(
    `INSERT INTO oauth_states (state, app_id, redirect_uri, expires_at)
     VALUES ($1, $2, $3, now() + interval '10 minutes')
     ON CONFLICT (state) DO UPDATE SET app_id = $2, expires_at = now() + interval '10 minutes'`,
    [state, appId, REDIRECT_URI]
  );

  const authUrl = new URL('https://open.larksuite.com/open-apis/authen/v2/authorize');
  authUrl.searchParams.set('app_id', config.app_id);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', [
    'calendar:calendar:read',
    'calendar:calendar.event:read',
    'calendar:calendar.event:create',
    'calendar:calendar.event:update',
    'calendar:calendar.event:delete',
    'contact:user.base:readonly',
    'contact:user:search',
    'im:message',
    'im:message:send_as_bot',
    'im:chat:read',
    'offline_access',
  ].join(' '));

  log.info({ appId, state: state.slice(0, 8) }, 'Redirecting to Lark OAuth');
  return Response.redirect(authUrl.toString(), 302);
}
