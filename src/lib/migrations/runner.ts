/**
 * GOR-133: Database Migration System
 * Zero-downtime migrations with version tracking.
 * 
 * Usage: npx tsx src/lib/migrations/runner.ts [up|down|status]
 */
import { query, getMany, getOne } from '../db';

interface Migration {
  version: string;
  name: string;
  up: string;
  down: string;
}

const migrations: Migration[] = [
  {
    version: '001',
    name: 'initial_schema',
    up: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        email TEXT UNIQUE,
        name TEXT,
        role TEXT DEFAULT 'user',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id TEXT NOT NULL REFERENCES users(id),
        title TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
    `,
    down: `
      DROP TABLE IF EXISTS messages CASCADE;
      DROP TABLE IF EXISTS conversations CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
    `,
  },
  {
    version: '002',
    name: 'tools_table',
    up: `
      CREATE TABLE IF NOT EXISTS tools (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name TEXT UNIQUE NOT NULL,
        description TEXT NOT NULL,
        schema JSONB NOT NULL,
        handler TEXT NOT NULL,
        enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `,
    down: `DROP TABLE IF EXISTS tools CASCADE;`,
  },
  {
    version: '003',
    name: 'proactive_tables',
    up: `
      CREATE TABLE IF NOT EXISTS proactive_rules (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        cron_expr TEXT NOT NULL,
        action TEXT NOT NULL,
        params JSONB DEFAULT '{}',
        enabled BOOLEAN DEFAULT true,
        last_run TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS proactive_runs (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        rule_id TEXT NOT NULL REFERENCES proactive_rules(id),
        status TEXT NOT NULL,
        output TEXT,
        error TEXT,
        started_at TIMESTAMPTZ DEFAULT now(),
        finished_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS approval_cache (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        tool_args JSONB NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_proactive_rules_user ON proactive_rules(user_id);
    `,
    down: `
      DROP TABLE IF EXISTS approval_cache CASCADE;
      DROP TABLE IF EXISTS proactive_runs CASCADE;
      DROP TABLE IF EXISTS proactive_rules CASCADE;
    `,
  },
  {
    version: '004',
    name: 'learning_tables',
    up: `
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT DEFAULT '',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS links (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        from_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        to_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        relation TEXT DEFAULT 'related',
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(from_note_id, to_note_id)
      );

      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'person',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(user_id, name)
      );

      CREATE TABLE IF NOT EXISTS entity_mentions (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        context TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
      CREATE INDEX IF NOT EXISTS idx_entities_user ON entities(user_id);
    `,
    down: `
      DROP TABLE IF EXISTS entity_mentions CASCADE;
      DROP TABLE IF EXISTS entities CASCADE;
      DROP TABLE IF EXISTS links CASCADE;
      DROP TABLE IF EXISTS notes CASCADE;
    `,
  },
  {
    version: '005',
    name: 'pgvector_embeddings',
    up: `
      CREATE EXTENSION IF NOT EXISTS vector;

      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding vector(1536),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON embeddings USING hnsw (embedding vector_cosine_ops);
      CREATE INDEX IF NOT EXISTS idx_embeddings_user ON embeddings(user_id);
    `,
    down: `
      DROP TABLE IF EXISTS embeddings CASCADE;
    `,
  },
  {
    version: '006',
    name: 'lark_config_table',
    up: `
      CREATE TABLE IF NOT EXISTS lark_config (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        app_id TEXT UNIQUE NOT NULL,
        app_secret TEXT NOT NULL,
        bot_open_id TEXT,
        user_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `,
    down: `DROP TABLE IF EXISTS lark_config CASCADE;`,
  },
  {
    version: '007',
    name: 'oauth_connections_table',
    up: `
      CREATE TABLE IF NOT EXISTS oauth_connections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        expires_at TIMESTAMPTZ,
        scopes TEXT[] DEFAULT '{}',
        provider_user_id TEXT,
        provider_user_name TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(user_id, provider)
      );
      CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_connections(user_id);
      CREATE INDEX IF NOT EXISTS idx_oauth_provider ON oauth_connections(provider);
    `,
    down: `DROP TABLE IF EXISTS oauth_connections CASCADE;`,
  },
];

// === Migration Runner ===

export async function ensureMigrationTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `);
}

export async function getAppliedMigrations(): Promise<string[]> {
  await ensureMigrationTable();
  const rows = await getMany<{ version: string }>(
    "SELECT version FROM _migrations ORDER BY version"
  );
  return rows.map(r => r.version);
}

export async function runMigrations(): Promise<{ applied: string[]; skipped: number }> {
  const applied = await getAppliedMigrations();
  const appliedSet = new Set(applied);
  const newlyApplied: string[] = [];

  for (const migration of migrations) {
    if (appliedSet.has(migration.version)) {
      continue;
    }

    console.log(`Applying migration ${migration.version}: ${migration.name}`);
    try {
      await query('BEGIN');
      await query(migration.up);
      await query(
        "INSERT INTO _migrations (version, name) VALUES ($1, $2)",
        [migration.version, migration.name]
      );
      await query('COMMIT');
      newlyApplied.push(migration.version);
      console.log(`  ✅ Applied`);
    } catch (err) {
      await query('ROLLBACK');
      console.error(`  ❌ Failed: ${err}`);
      throw err;
    }
  }

  return { applied: newlyApplied, skipped: applied.length };
}

export async function rollbackMigration(version: string): Promise<void> {
  const migration = migrations.find(m => m.version === version);
  if (!migration) throw new Error(`Migration ${version} not found`);

  console.log(`Rolling back migration ${version}: ${migration.name}`);
  await query('BEGIN');
  try {
    await query(migration.down);
    await query("DELETE FROM _migrations WHERE version = $1", [version]);
    await query('COMMIT');
    console.log(`  ✅ Rolled back`);
  } catch (err) {
    await query('ROLLBACK');
    console.error(`  ❌ Failed: ${err}`);
    throw err;
  }
}

export async function getMigrationStatus(): Promise<Array<{ version: string; name: string; applied: boolean; appliedAt?: string }>> {
  const applied = await getAppliedMigrations();
  const appliedSet = new Set(applied);
  
  const appliedDetails = await getMany<{ version: string; applied_at: string }>(
    "SELECT version, applied_at FROM _migrations ORDER BY version"
  );
  const appliedMap = new Map(appliedDetails.map(r => [r.version, r.applied_at]));

  return migrations.map(m => ({
    version: m.version,
    name: m.name,
    applied: appliedSet.has(m.version),
    appliedAt: appliedMap.get(m.version),
  }));
}

// CLI runner
if (require.main === module) {
  (async () => {
    const cmd = process.argv[2] || 'up';
    try {
      if (cmd === 'up') {
        const result = await runMigrations();
        console.log(`\nDone. Applied: ${result.applied.length}, Already applied: ${result.skipped}`);
      } else if (cmd === 'down') {
        const version = process.argv[3];
        if (!version) { console.error('Usage: runner.ts down <version>'); process.exit(1); }
        await rollbackMigration(version);
      } else if (cmd === 'status') {
        const status = await getMigrationStatus();
        console.log('\nMigration Status:');
        for (const s of status) {
          const icon = s.applied ? '✅' : '⬜';
          console.log(`  ${icon} ${s.version}: ${s.name}${s.applied ? ` (${s.appliedAt})` : ''}`);
        }
      }
      process.exit(0);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  })();
}
