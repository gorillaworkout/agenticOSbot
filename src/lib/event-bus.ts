/**
 * GOR-107: Internal Event Bus using EventEmitter3
 * 
 * Provides reactive event-driven triggers for proactive features.
 * Events can trigger: notifications, tool executions, learning, etc.
 */
import EventEmitter from 'eventemitter3';
import { childLogger } from './logger';

const log = childLogger('event-bus');

// Event type definitions
export interface BusEvents {
  // Message events
  'message:received': { userId: string; chatId: string; text: string; senderId: string };
  'message:sent': { userId: string; chatId: string; text: string };
  
  // Tool events
  'tool:executed': { userId: string; toolName: string; success: boolean; duration: number };
  'tool:failed': { userId: string; toolName: string; error: string };
  
  // Calendar events
  'calendar:upcoming': { userId: string; event: Record<string, unknown> };
  'calendar:created': { userId: string; eventId: string; summary: string };
  'calendar:updated': { userId: string; eventId: string };
  'calendar:deleted': { userId: string; eventId: string };
  
  // Task events
  'task:created': { userId: string; taskId: string; title: string };
  'task:completed': { userId: string; taskId: string; title: string };
  
  // Approval events
  'approval:pending': { userId: string; approvalId: string; title: string };
  'approval:approved': { userId: string; approvalId: string };
  'approval:rejected': { userId: string; approvalId: string };
  
  // Learning events
  'learning:note_created': { userId: string; noteId: string; title: string };
  'learning:entity_created': { userId: string; entityId: string; name: string };
  'learning:auto_learned': { userId: string; type: string; value: string };
  'learning:persona_updated': { userId: string };
  
  // System events
  'system:startup': { timestamp: Date };
  'system:shutdown': { timestamp: Date };
  'system:error': { error: string; context: string };
  
  // Proactive events
  'proactive:briefing_sent': { userId: string };
  'proactive:reminder_sent': { userId: string; eventId: string };
  'proactive:digest_sent': { userId: string };
  
  // HITL events
  'hitl:confirmation_needed': { userId: string; toolName: string; pendingId: string };
  'hitl:confirmed': { userId: string; pendingId: string };
  'hitl:rejected': { userId: string; pendingId: string };
  
  // User events
  'user:connected': { userId: string; channel: string };
  'user:disconnected': { userId: string; channel: string };
}

// Create event bus (using any for EventEmitter3 compatibility)
const bus = new EventEmitter();

// Event statistics
const eventStats = new Map<string, { count: number; lastFired: Date }>();

/**
 * Emit an event with automatic stats tracking.
 */
export function emit<K extends keyof BusEvents>(event: K, data: BusEvents[K]): void {
  const stats = eventStats.get(event as string) || { count: 0, lastFired: new Date() };
  stats.count++;
  stats.lastFired = new Date();
  eventStats.set(event as string, stats);
  
  log.debug({ event: event as string, data }, 'Event emitted');
  bus.emit(event, data);
}

/**
 * Subscribe to an event.
 */
export function on<K extends keyof BusEvents>(
  event: K,
  handler: (data: BusEvents[K]) => void | Promise<void>
): void {
  bus.on(event, handler as (...args: unknown[]) => void);
  log.debug({ event: event as string }, 'Event handler registered');
}

/**
 * Subscribe to an event (one-time).
 */
export function once<K extends keyof BusEvents>(
  event: K,
  handler: (data: BusEvents[K]) => void | Promise<void>
): void {
  bus.once(event, handler as (...args: unknown[]) => void);
}

/**
 * Unsubscribe from an event.
 */
export function off<K extends keyof BusEvents>(
  event: K,
  handler: (data: BusEvents[K]) => void | Promise<void>
): void {
  bus.off(event, handler as (...args: unknown[]) => void);
}

/**
 * Get event statistics.
 */
export function getEventStats(): Array<{ event: string; count: number; lastFired: Date }> {
  return Array.from(eventStats.entries()).map(([event, stats]) => ({
    event,
    ...stats,
  }));
}

/**
 * Get all registered event names.
 */
export function getRegisteredEvents(): string[] {
  return bus.eventNames() as string[];
}

// Initialize default handlers
export function initEventBus(): void {
  // Log important events
  on('system:error', (data) => {
    log.error({ error: data.error, context: data.context }, 'System error event');
  });
  
  on('tool:failed', (data) => {
    log.warn({ tool: data.toolName, error: data.error }, 'Tool failed event');
  });
  
  on('hitl:confirmation_needed', (data) => {
    log.info({ tool: data.toolName, pendingId: data.pendingId }, 'HITL confirmation needed');
  });
  
  log.info('Event bus initialized');
}

export default bus;
