-- GOR-78: Error Handling & Observability

-- Error logs
CREATE TABLE IF NOT EXISTS error_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'error', 'critical')),
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  stack_trace TEXT,
  context JSONB DEFAULT '{}',
  request_id TEXT,
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_severity ON error_logs(severity);
CREATE INDEX IF NOT EXISTS idx_error_logs_source ON error_logs(source);
CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at DESC);

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- GOR-67: Data Monitoring & Alerts

-- Metrics
CREATE TABLE IF NOT EXISTS metrics (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  labels JSONB DEFAULT '{}',
  recorded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_metrics_recorded ON metrics(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_name_recorded ON metrics(metric_name, recorded_at DESC);

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('gt', 'lt', 'eq', 'gte', 'lte')),
  threshold NUMERIC NOT NULL,
  window_minutes INT NOT NULL DEFAULT 5,
  enabled BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_metric ON alerts(metric_name) WHERE enabled = true;

-- Alert history
CREATE TABLE IF NOT EXISTS alert_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  metric_value NUMERIC,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_history_alert ON alert_history(alert_id, created_at DESC);

-- GOR-68: Report Generator

-- Reports
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  report_type TEXT NOT NULL CHECK (report_type IN ('usage', 'activity', 'performance', 'custom')),
  config JSONB NOT NULL DEFAULT '{}',
  schedule TEXT, -- cron expression or null for manual
  last_generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id);

-- Report history
CREATE TABLE IF NOT EXISTS report_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'generating' CHECK (status IN ('generating', 'completed', 'failed')),
  output_path TEXT,
  output_data JSONB,
  error TEXT,
  generated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_history_report ON report_history(report_id, created_at DESC);

-- GOR-76: Data Aggregation Layer

-- Aggregations
CREATE TABLE IF NOT EXISTS aggregations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_table TEXT NOT NULL,
  group_by_fields JSONB DEFAULT '[]',
  aggregations JSONB NOT NULL DEFAULT '{}', -- {field: "sum|avg count|min|max"}
  filter JSONB DEFAULT '{}',
  schedule TEXT,
  last_run_at TIMESTAMPTZ,
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aggregations_user ON aggregations(user_id);
