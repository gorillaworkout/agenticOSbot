-- GOR-98: Proactive Engine — cron scheduler + event router
-- GOR-94: Morning Briefing
-- GOR-95: Approval Auto-Handler
-- GOR-96: Meeting Reminder
-- GOR-97: Smart Context

-- Proactive rules: define what the bot should do proactively
CREATE TABLE IF NOT EXISTS proactive_rules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cron', 'webhook', 'event')),
  -- For cron: cron expression like "0 8 * * *" (8am daily)
  -- For webhook: event type like "approval.created"
  -- For event: condition like "message.contains_link"
  trigger_config JSONB NOT NULL,
  -- What action to take: 'summarize', 'notify', 'tool_call', 'llm_response'
  action_type TEXT NOT NULL,
  action_config JSONB NOT NULL,
  enabled BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  run_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proactive_rules_user ON proactive_rules(user_id, enabled);
CREATE INDEX IF NOT EXISTS idx_proactive_rules_next ON proactive_rules(next_run_at) WHERE enabled = true;

-- Proactive run logs
CREATE TABLE IF NOT EXISTS proactive_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  rule_id TEXT NOT NULL REFERENCES proactive_rules(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  input TEXT,
  output TEXT,
  error TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_proactive_runs_rule ON proactive_runs(rule_id, started_at DESC);

-- Approval webhook cache: track approvals for auto-handler
CREATE TABLE IF NOT EXISTS approval_cache (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  instance_code TEXT NOT NULL,
  task_id TEXT,
  approval_name TEXT,
  applicant_name TEXT,
  form_data JSONB,
  status TEXT DEFAULT 'pending',
  notified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_cache_user ON approval_cache(user_id, status, notified);

-- Calendar reminders: track which reminders were sent
CREATE TABLE IF NOT EXISTS calendar_reminders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('15min', '5min', 'start')),
  sent_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, event_id, reminder_type)
);

-- Lark user config: store default Lark app_id per user for proactive actions
CREATE TABLE IF NOT EXISTS lark_user_config (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  lark_user_id TEXT,
  chat_id TEXT, -- default chat for proactive messages
  timezone TEXT DEFAULT 'Asia/Jakarta',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, app_id)
);
