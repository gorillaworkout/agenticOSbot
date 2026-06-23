import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { chatCompletion } from '@/lib/llm';
import { executeTool } from '@/lib/tools';
import { z } from 'zod';
import { childLogger } from '@/lib/logger';

const log = childLogger('workflow:run');

const RunWorkflowSchema = z.object({
  input: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

interface WorkflowStep {
  type: 'tool_call' | 'llm_prompt' | 'condition' | 'human_approval';
  name?: string;
  config: Record<string, unknown>;
  dependsOn?: number;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;

  const body = await parseBody<z.infer<typeof RunWorkflowSchema>>(request);
  const parsed = RunWorkflowSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  // Fetch workflow
  const workflow = await getOne<{ id: string; name: string; steps: WorkflowStep[]; enabled: boolean }>(
    'SELECT id, name, steps, enabled FROM workflows WHERE id = $1 AND user_id = $2',
    [id, user!.id]
  );
  if (!workflow) return err('Workflow not found', 404);
  if (!workflow.enabled) return err('Workflow is disabled', 400);

  const steps = workflow.steps;
  const runContext: Record<string, unknown> = { input: parsed.data.input || '', ...parsed.data.context };
  const stepOutputs: Record<number, unknown> = {};

  // Create workflow run record
  const run = await getOne<{ id: string }>(
    `INSERT INTO workflow_runs (workflow_id, user_id, status, context)
     VALUES ($1, $2, 'RUNNING', $3) RETURNING id`,
    [id, user!.id, JSON.stringify(runContext)]
  );
  const runId = run!.id;

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Update current step
      await query('UPDATE workflow_runs SET current_step = $1 WHERE id = $2', [i, runId]);

      // Check dependencies
      if (step.dependsOn !== undefined && step.dependsOn in stepOutputs) {
        runContext[`step_${step.dependsOn}_output`] = stepOutputs[step.dependsOn];
      }

      let stepResult: unknown;

      switch (step.type) {
        case 'tool_call': {
          const toolName = step.name || (step.config.tool as string);
          const toolArgs = (step.config.args as Record<string, unknown>) || {};
          // Resolve template vars in args
          const resolvedArgs = resolveTemplate(toolArgs, runContext);
          const result = await executeTool(toolName, resolvedArgs);
          stepResult = result;
          break;
        }

        case 'llm_prompt': {
          const prompt = resolveTemplateString(step.config.prompt as string || '', runContext);
          const response = await chatCompletion([
            { role: 'system', content: step.config.systemPrompt as string || 'You are a helpful assistant.' },
            { role: 'user', content: prompt },
          ]);
          stepResult = { content: response.content, model: response.model, usage: response.usage };
          break;
        }

        case 'condition': {
          const condition = step.config.condition as string;
          // Simple condition evaluation: check if a key exists or is truthy
          const key = condition.replace(/^!?\s*/, '');
          const negate = condition.startsWith('!');
          const val = runContext[key] ?? stepOutputs[step.dependsOn ?? -1];
          stepResult = { result: negate ? !val : !!val };
          break;
        }

        case 'human_approval': {
          // Mark as waiting — the run will pause here
          await query(
            "UPDATE workflow_runs SET status = 'WAITING_APPROVAL', context = $1 WHERE id = $2",
            [JSON.stringify({ ...runContext, pendingStep: i, stepOutputs }), runId]
          );
          return ok({
            runId,
            status: 'WAITING_APPROVAL',
            step: i,
            message: step.config.message || 'Approval required to continue',
          });
        }
      }

      stepOutputs[i] = stepResult;
      runContext[`step_${i}_output`] = stepResult;
      log.info({ runId, step: i, type: step.type }, 'Workflow step completed');
    }

    // All steps done
    await query(
      "UPDATE workflow_runs SET status = 'COMPLETED', output = $1, completed_at = now() WHERE id = $2",
      [JSON.stringify(stepOutputs), runId]
    );

    return ok({
      runId,
      status: 'COMPLETED',
      outputs: stepOutputs,
      stepsExecuted: steps.length,
    });
  } catch (e) {
    log.error({ err: e, runId }, 'Workflow execution failed');
    await query(
      "UPDATE workflow_runs SET status = 'FAILED', output = $1, completed_at = now() WHERE id = $2",
      [String(e), runId]
    );
    return err(`Workflow failed: ${String(e)}`, 500);
  }
}

function resolveTemplate(obj: Record<string, unknown>, ctx: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      result[k] = resolveTemplateString(v, ctx);
    } else {
      result[k] = v;
    }
  }
  return result;
}

function resolveTemplateString(str: string, ctx: Record<string, unknown>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = ctx[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}
