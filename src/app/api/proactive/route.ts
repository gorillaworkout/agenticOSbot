import { ok, err, parseBody } from '@/lib/api';
import { childLogger } from '@/lib/logger';
import { runProactiveScheduler, runMorningBriefing, checkMeetingReminders, setupDefaultProactiveRules, runDailyChatSummary, runDeadlineTracker } from '@/lib/proactive';
import { getOne, getMany } from '@/lib/db';

const log = childLogger('api:proactive');

// POST /api/proactive — Trigger proactive actions
export async function POST(request: Request) {
  try {
    const body = await parseBody<{ action?: string; userId?: string }>(request);
    const { action, userId } = body;

    switch (action) {
      case 'scheduler':
        await runProactiveScheduler();
        return ok({ message: 'Proactive scheduler executed' });

      case 'morning_briefing': {
        if (!userId) return err('userId required', 400);
        const config = await getOne<{ app_id: string; chat_id: string }>(
          'SELECT app_id, chat_id FROM lark_user_config WHERE user_id = $1 AND enabled = true LIMIT 1',
          [userId]
        );
        if (!config) return err('No lark_user_config found for user', 404);
        const briefing = await runMorningBriefing(userId, config.app_id, config.chat_id);
        return ok({ briefing });
      }

      case 'meeting_reminder': {
        if (!userId) return err('userId required', 400);
        const config2 = await getOne<{ app_id: string; chat_id: string }>(
          'SELECT app_id, chat_id FROM lark_user_config WHERE user_id = $1 AND enabled = true LIMIT 1',
          [userId]
        );
        if (!config2) return err('No lark_user_config found', 404);
        const count = await checkMeetingReminders(userId, config2.app_id, config2.chat_id);
        return ok({ reminders_sent: count });
      }

      case 'setup_defaults': {
        if (!userId) return err('userId required', 400);
        await setupDefaultProactiveRules(userId);
        return ok({ message: 'Default proactive rules created' });
      }

      case 'daily_summary': {
        if (!userId) return err('userId required', 400);
        const config3 = await getOne<{ app_id: string; chat_id: string }>(
          'SELECT app_id, chat_id FROM lark_user_config WHERE user_id = $1 AND enabled = true LIMIT 1',
          [userId]
        );
        if (!config3) return err('No lark_user_config found', 404);
        const summary = await runDailyChatSummary(userId, config3.app_id, config3.chat_id);
        return ok({ summary });
      }

      case 'deadline_tracker': {
        if (!userId) return err('userId required', 400);
        const config4 = await getOne<{ app_id: string; chat_id: string }>(
          'SELECT app_id, chat_id FROM lark_user_config WHERE user_id = $1 AND enabled = true LIMIT 1',
          [userId]
        );
        if (!config4) return err('No lark_user_config found', 404);
        const deadlines = await runDeadlineTracker(userId, config4.app_id, config4.chat_id);
        return ok({ deadlines });
      }

      default:
        return err('Unknown action. Use: scheduler, morning_briefing, meeting_reminder, setup_defaults, daily_summary, deadline_tracker', 400);
    }
  } catch (e) {
    log.error({ err: e }, 'Proactive API error');
    return err('Proactive action failed', 500);
  }
}

// GET /api/proactive — List rules and recent runs
export async function GET() {
  try {
    const rules = await getMany('SELECT * FROM proactive_rules ORDER BY created_at DESC LIMIT 50');
    const runs = await getMany('SELECT * FROM proactive_runs ORDER BY started_at DESC LIMIT 20');
    return ok({ rules, runs });
  } catch (e) {
    log.error({ err: e }, 'Proactive GET error');
    return err('Failed to fetch proactive data', 500);
  }
}
