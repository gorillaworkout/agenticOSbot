-- Seed workflow templates for default user
DO $$ DECLARE u_id text;
BEGIN
  SELECT id INTO u_id FROM users LIMIT 1;
  IF u_id IS NOT NULL THEN
    INSERT INTO workflow_templates (user_id, name, description, category, steps, public, use_count) VALUES
    (u_id, 'Daily Report', 'Generate a daily usage report from the system', 'reporting', '[{"type":"llm_prompt","name":"Generate Report","config":{"prompt":"Generate a summary of today system activity including messages, agent runs, and errors.","systemPrompt":"You are a report generator. Provide concise daily summaries."}}]', true, 0),
    (u_id, 'Error Alert Check', 'Check for new errors and summarize critical ones', 'monitoring', '[{"type":"tool_call","name":"error_logs_search","config":{"table":"error_logs","severity":"critical","limit":"5"}},{"type":"llm_prompt","name":"Summarize Errors","config":{"prompt":"Summarize these critical errors: {{step_0_output}}","systemPrompt":"You are an error analyst. Provide brief, actionable summaries."}}]', true, 0),
    (u_id, 'Conversation Summary', 'Summarize a conversation history', 'utility', '[{"type":"llm_prompt","name":"Summarize","config":{"prompt":"Summarize the following conversation concisely: {{input}}","systemPrompt":"You are a conversation summarizer. Be concise but capture key points."}}]', true, 0)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Register workflow template and plugin tools
INSERT INTO tools (name, description, schema, handler, enabled) VALUES
('workflow_template_list', 'List available public workflow templates', '{"type":"object","properties":{"limit":{"type":"number","description":"Max results"}},"required":[]}', 'workflow_template_list', true),
('plugin_list', 'List installed plugins', '{"type":"object","properties":{"limit":{"type":"number","description":"Max results"}},"required":[]}', 'plugin_list', true),
('plugin_info', 'Get detailed info about a plugin', '{"type":"object","properties":{"pluginId":{"type":"string","description":"Plugin ID"}},"required":["pluginId"]}', 'plugin_info', true)
ON CONFLICT (name) DO NOTHING;
