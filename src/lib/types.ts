// ─── Agent Runtime Types ─────────────────────────────────────────────────────

export type AgentStatus = 'PENDING' | 'PLANNING' | 'EXECUTING' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface AgentStep {
  id: string;
  type: 'llm_call' | 'tool_call' | 'condition' | 'approval';
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input?: unknown;
  output?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  handler: (params: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  executionTimeMs?: number;
  data?: unknown;
  error?: string;
}

// ─── Integration Types ───────────────────────────────────────────────────────

export type IntegrationType = 'LARK' | 'MICROSOFT_365' | 'XERO' | 'LINEAR' | 'WEBHOOK' | 'CUSTOM';

export interface IntegrationConfig {
  type: IntegrationType;
  name: string;
  credentials: Record<string, string>;
  config: Record<string, unknown>;
}

// ─── LLM Types ───────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: { prompt: number; completion: number; total: number };
  finishReason: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
}

// ─── Workflow Types ──────────────────────────────────────────────────────────

export type WorkflowStepType = 'llm_call' | 'tool_call' | 'condition' | 'loop' | 'parallel' | 'human_approval';

export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  name: string;
  config: Record<string, unknown>;
  next?: string; // next step id
  onError?: string; // error handler step id
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  triggers?: Array<{ type: 'cron' | 'event' | 'manual'; config: Record<string, unknown> }>;
}

// ─── User Types ──────────────────────────────────────────────────────────────

export type UserRole = 'ADMIN' | 'USER' | 'VIEWER';

export interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

// ─── API Types ───────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination?: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}
