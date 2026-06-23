-- GOR-75: Workflow Templates
CREATE TABLE IF NOT EXISTS workflow_templates (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'general',
  steps JSONB NOT NULL DEFAULT '[]',
  public BOOLEAN DEFAULT false,
  use_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_templates_user ON workflow_templates(user_id);

-- GOR-74: Plugin System
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  version TEXT DEFAULT '1.0.0',
  plugin_type TEXT NOT NULL CHECK (plugin_type IN ('tool_provider', 'webhook_handler', 'ui_component', 'scheduler')),
  config JSONB DEFAULT '{}',
  enabled BOOLEAN DEFAULT false,
  manifest JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plugins_user ON plugins(user_id);

CREATE TABLE IF NOT EXISTS plugin_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  message TEXT NOT NULL,
  context JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plugin_logs_plugin ON plugin_logs(plugin_id, created_at DESC);

-- Add step_results column to workflow_runs if not exists
DO $$ BEGIN
  ALTER TABLE workflow_runs ADD COLUMN step_results JSONB DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
