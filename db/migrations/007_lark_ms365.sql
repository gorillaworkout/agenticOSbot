-- GOR-65: Lark Full API Integration
CREATE TABLE IF NOT EXISTS lark_bitable_records (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_token TEXT NOT NULL,
  table_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  fields JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lark_bitable_records_table ON lark_bitable_records(app_token, table_id);

-- GOR-64: Microsoft 365 Integration
CREATE TABLE IF NOT EXISTS ms365_config (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret_encrypted TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[] DEFAULT ARRAY['Calendars.ReadWrite', 'Mail.Send', 'Files.ReadWrite'],
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ms365_sync_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('email', 'calendar', 'onedrive', 'teams')),
  action TEXT NOT NULL CHECK (action IN ('sync', 'create', 'update', 'delete')),
  entity_id TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
