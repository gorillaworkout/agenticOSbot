import { query, getOne, getMany } from './db';

export interface ErrorLogOptions {
  userId?: string;
  severity: 'info' | 'warn' | 'error' | 'critical';
  source: string;
  message: string;
  stackTrace?: string;
  context?: Record<string, unknown>;
  requestId?: string;
}

export async function logError(opts: ErrorLogOptions): Promise<string> {
  const row = await getOne<{ id: string }>(
    `INSERT INTO error_logs (user_id, severity, source, message, stack_trace, context, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [opts.userId || null, opts.severity, opts.source, opts.message, opts.stackTrace || null, JSON.stringify(opts.context || {}), opts.requestId || null]
  );
  return row?.id || '';
}

export async function logAudit(opts: {
  userId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}): Promise<string> {
  const row = await getOne<{ id: string }>(
    `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [opts.userId || null, opts.action, opts.resourceType, opts.resourceId || null, JSON.stringify(opts.details || {}), opts.ipAddress || null, opts.userAgent || null]
  );
  return row?.id || '';
}

export async function logMetric(name: string, value: number, labels?: Record<string, unknown>): Promise<void> {
  await query(
    'INSERT INTO metrics (metric_name, metric_value, labels) VALUES ($1, $2, $3)',
    [name, value, JSON.stringify(labels || {})]
  );
  // Check alerts for this metric
  await checkAlerts(name, value);
}

async function checkAlerts(metricName: string, currentValue: number): Promise<void> {
  const alerts = await getMany<{
    id: string; user_id: string; name: string; condition: string;
    threshold: number; window_minutes: number; last_triggered_at: string | null;
  }>(
    `SELECT * FROM alerts WHERE metric_name = $1 AND enabled = true`,
    [metricName]
  );

  for (const alert of alerts) {
    let fired = false;
    switch (alert.condition) {
      case 'gt': fired = currentValue > alert.threshold; break;
      case 'gte': fired = currentValue >= alert.threshold; break;
      case 'lt': fired = currentValue < alert.threshold; break;
      case 'lte': fired = currentValue <= alert.threshold; break;
      case 'eq': fired = currentValue === alert.threshold; break;
    }

    if (fired) {
      await query(
        `INSERT INTO alert_history (alert_id, metric_value, message) VALUES ($1, $2, $3)`,
        [alert.id, currentValue, `Alert "${alert.name}" fired: ${metricName} = ${currentValue} (${alert.condition} ${alert.threshold})`]
      );
      await query(
        `UPDATE alerts SET last_triggered_at = now() WHERE id = $1`,
        [alert.id]
      );
    }
  }
}
