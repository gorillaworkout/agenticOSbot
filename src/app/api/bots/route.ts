import { ok, err } from '@/lib/api';
import { query, getMany, getOne } from '@/lib/db';
import { childLogger } from '@/lib/logger';
import { encrypt } from '@/lib/crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const log = childLogger('api:bots');
const execAsync = promisify(exec);
const CWD = '/home/ubuntu/apps/agentic-os';

// GET /api/bots — list all registered bots with auth status
export async function GET() {
  try {
    const rows = await getMany<{
      app_id: string; bot_name: string; enabled: boolean;
    }>('SELECT app_id, bot_name, enabled FROM lark_config ORDER BY bot_name');

    const bots = await Promise.all(rows.map(async (r) => {
      // Check DB token — get the real token info
      const dbToken = await getOne<{ user_id: string; access_token: string; refresh_token: string; expires_at: Date; scopes: string[] }>(
        'SELECT user_id, access_token, refresh_token, expires_at, scopes FROM lark_user_tokens WHERE app_id = $1 ORDER BY updated_at DESC LIMIT 1',
        [r.app_id]
      );

      // Check lark-cli profile for user name fallback
      let profileUser = '';
      try {
        const { stdout } = await execAsync('lark-cli profile list', { cwd: CWD });
        const profiles = JSON.parse(stdout);
        const profile = Array.isArray(profiles)
          ? profiles.find((p: Record<string, string>) => p.appId === r.app_id || p['app-id'] === r.app_id)
          : null;
        if (profile) profileUser = (profile.user as string) || '';
      } catch {}

      const hasRealToken = !!dbToken && dbToken.access_token !== 'lark-cli-managed';
      const hasCliToken = !!profileUser;
      const hasUserToken = hasRealToken || hasCliToken;
      const userName = hasRealToken ? (dbToken?.user_id || 'User') : (profileUser || undefined);

      return {
        app_id: r.app_id,
        bot_name: r.bot_name,
        enabled: r.enabled,
        has_user_token: hasUserToken,
        user_name: userName,
        token_expires_at: hasRealToken ? dbToken?.expires_at?.toISOString() : undefined,
        scopes: hasRealToken ? dbToken?.scopes : undefined,
      };
    }));

    return ok(bots);
  } catch (e) {
    log.error({ err: e }, 'Failed to list bots');
    return err('Failed to list bots', 500);
  }
}

// POST /api/bots — register a new bot
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { appId, appSecret, botName } = body;

    if (!appId || !appSecret || !botName) {
      return err('appId, appSecret, botName are required', 400);
    }

    // Verify credentials
    const tokenRes = await fetch('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.code !== 0) {
      return err(`Invalid credentials: ${tokenData.msg}`, 400);
    }

    const encSecret = encrypt(appSecret);

    await query(
      `INSERT INTO lark_config (app_id, app_secret, app_secret_enc, bot_name, enabled, user_id)
       VALUES ($1, $2, $3, $4, true, $5)
       ON CONFLICT (user_id, app_id) DO UPDATE SET
         app_secret = EXCLUDED.app_secret,
         app_secret_enc = EXCLUDED.app_secret_enc,
         bot_name = EXCLUDED.bot_name,
         enabled = true,
         updated_at = now()`,
      [appId, appSecret, encSecret, botName, '0ae586e8-ec1b-4da2-a024-0d0e92cdb213']
    );

    // Also add as lark-cli profile
    try {
      const profileName = botName.toLowerCase().replace(/[^a-z0-9]/g, '-');
      await execAsync(
        `echo "${appSecret}" | lark-cli profile add --name "${profileName}" --app-id "${appId}" --app-secret-stdin --brand lark`,
        { cwd: CWD }
      );
    } catch (e) {
      log.warn({ err: e }, 'lark-cli profile add failed (may exist)');
    }

    log.info({ appId, botName }, 'Bot registered');
    return ok({ appId, botName });
  } catch (e) {
    log.error({ err: e }, 'Failed to register bot');
    return err('Failed to register bot', 500);
  }
}

// DELETE /api/bots?appId=xxx — remove a bot
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const appId = url.searchParams.get('appId');
  if (!appId) return err('appId required', 400);

  try {
    // Remove user tokens first
    await query('DELETE FROM lark_user_tokens WHERE app_id = $1', [appId]);
    // Remove bot config
    await query('DELETE FROM lark_config WHERE app_id = $1', [appId]);
    log.info({ appId }, 'Bot removed');
    return ok({ removed: appId });
  } catch (e) {
    log.error({ err: e }, 'Failed to remove bot');
    return err('Failed to remove bot', 500);
  }
}
