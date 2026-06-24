import { getMany, getOne, query } from './db';
import { getLarkUserTokenFromDB } from './lark-api';
import * as fs from 'fs';
import * as path from 'path';

// Resolve lark-cli profile name for a given app_id
async function getLarkProfile(appId?: string): Promise<string> {
  if (!appId) return '';
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const { stdout } = await execAsync('lark-cli profile list', { cwd: '/home/ubuntu/apps/agentic-os' });
    const profiles = JSON.parse(stdout);
    if (Array.isArray(profiles)) {
      const match = profiles.find((p: Record<string, string>) => p.appId === appId || p['app-id'] === appId);
      if (match) return match.name || match.profileName || '';
    }
  } catch {}
  return '';
}



export interface ToolResult {
  success: boolean;
  output: string;
  executionTimeMs?: number;
  filePath?: string;
}

export interface LLMToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

// Tool Registry
export async function getToolDefinitions(): Promise<LLMToolDef[]> {
  const rows = await getMany<{ name: string; description: string; schema: any; enabled: boolean }>(
    "SELECT name, description, schema FROM tools WHERE enabled = true"
  );
  return rows.map(r => ({
    type: 'function' as const,
    function: {
      name: r.name,
      description: r.description,
      parameters: r.schema,
    },
  }));
}

export async function getToolByName(name: string) {
  return getOne<{ id: string; name: string; description: string; schema: any; enabled: boolean }>(
    "SELECT * FROM tools WHERE name = $1", [name]
  );
}

// Tool execution
export async function executeTool(name: string, args: Record<string, unknown>, context?: { appId?: string; chatId?: string; userId?: string }): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    let result: string;

    // Common aliases to make the agent more robust against name hallucinations
    const aliases: Record<string, string> = {
      'get_current_time': 'current_time',
      'get_time': 'current_time',
      'time': 'current_time',
      'now': 'current_time',
      'datetime': 'current_time',
      'date': 'current_time',
      'get_date': 'current_time',
      'get_current_date': 'current_time',
      'get_current_datetime': 'current_time',
      'web_search': 'web_search',
      'search': 'web_search',
      'search_web': 'web_search',
      'google': 'web_search',
      'fetch_url': 'web_fetch',
      'fetch': 'web_fetch',
      'url_fetch': 'web_fetch',
      'read_url': 'web_fetch',
      'calc': 'calculator',
      'calculate': 'calculator',
      'math': 'calculator',
      'create_note': 'note_create',
      'add_note': 'note_create',
      'search_notes': 'note_search',
      'find_notes': 'note_search',
      'list_notes': 'note_list',
      'get_notes': 'note_list',
      'search_kb': 'kb_search',
      'add_kb': 'kb_add',
      'search_graphify': 'graphify_search',
      'query_graphify': 'graphify_query',
      'search_codebase': 'graphify_search',
      'query_codebase': 'graphify_query',
      'get_memory': 'memory_get',
      'read_memory': 'memory_get',
      'set_memory': 'memory_set',
      'save_memory': 'memory_set',
      'list_tasks': 'task_list',
      'delete_task': 'task_delete',
      'list_workflows': 'workflow_list',
      'run_workflow': 'workflow_run',
      'send_message': 'lark_send_message',
      'create_pdf': 'generate_pdf',
      'make_pdf': 'generate_pdf',
      'pdf_generate': 'generate_pdf',
      'write_pdf': 'generate_pdf',
      'build_pdf': 'generate_pdf',
      'read_doc': 'lark_docs_read',
      'read_document': 'lark_docs_read',
      'lark_document_read': 'lark_docs_read',
      'create_doc': 'lark_docs_create',
      'create_document': 'lark_docs_create',
      'lark_document_create': 'lark_docs_create',
      'update_doc': 'lark_docs_update',
      'edit_doc': 'lark_docs_update',
      'lark_document_update': 'lark_docs_update',
      'list_wiki_spaces': 'lark_wiki_list_spaces',
      'wiki_spaces': 'lark_wiki_list_spaces',
      'list_wiki_nodes': 'lark_wiki_list_nodes',
      'wiki_nodes': 'lark_wiki_list_nodes',
      'get_wiki_node': 'lark_wiki_get_node',
      'wiki_node': 'lark_wiki_get_node',
      'read_sheet': 'lark_sheets_read',
      'read_spreadsheet': 'lark_sheets_read',
      'lark_spreadsheet_read': 'lark_sheets_read',
      'write_sheet': 'lark_sheets_write',
      'write_spreadsheet': 'lark_sheets_write',
      'lark_spreadsheet_write': 'lark_sheets_write',
      'create_sheet': 'lark_sheets_create',
      'create_spreadsheet': 'lark_sheets_create',
      'lark_spreadsheet_create': 'lark_sheets_create',
      'sheet_info': 'lark_sheets_info',
      'spreadsheet_info': 'lark_sheets_info',
      'create_task': 'lark_task_create',
      'add_task': 'lark_task_create',
      'my_tasks': 'lark_task_list',
      'complete_task': 'lark_task_complete',
      'finish_task': 'lark_task_complete',
      'search_tasks': 'lark_task_search',
      'find_task': 'lark_task_search',
      'my_approvals': 'lark_approval_list',
      'list_approvals': 'lark_approval_list',
      'approve': 'lark_approval_approve',
      'reject': 'lark_approval_reject',
      'search_files': 'lark_drive_search',
      'search_drive': 'lark_drive_search',
      'drive_search': 'lark_drive_search',
      'upload_file': 'lark_drive_upload',
      'drive_upload': 'lark_drive_upload',
      'download_file': 'lark_drive_download',
      'drive_download': 'lark_drive_download',
      'create_folder': 'lark_drive_create_folder',
      'search_meetings': 'lark_vc_search',
      'find_meetings': 'lark_vc_search',
      'active_meetings': 'lark_vc_list_active',
      'meeting_notes': 'lark_vc_notes',
      'search_messages': 'lark_message_search',
      'find_messages': 'lark_message_search',
      'list_groups': 'lark_group_list',
      'my_groups': 'lark_group_list',
      'create_group': 'lark_group_create',
      'group_members': 'lark_group_members',
      'list_members': 'lark_group_members',
    };
    const realName = aliases[name] || name;

    switch (realName) {
      case 'web_search':
        result = await webSearch(args.query as string, (args.maxResults as number) || 5);
        break;
      case 'web_fetch':
        result = await webFetch(args.url as string, (args.maxChars as number) || 10000);
        break;
      case 'calculator':
        result = calculator(args.expression as string);
        break;
      case 'note_create':
        result = await noteCreate(args.title as string, args.content as string, args.tags as string[] | undefined);
        break;
      case 'note_search':
        result = await noteSearch(args.query as string);
        break;
      case 'note_list':
        result = await noteList(args.limit as number | undefined);
        break;
      case 'current_time':
        result = currentTime(args.timezone as string | undefined);
        break;
      case 'memory_get':
        result = await memoryGet(args.namespace as string | undefined, args.key as string);
        break;
      case 'memory_set':
        result = await memorySet(args.namespace as string | undefined, args.key as string, args.value);
        break;
      case 'kb_search':
        result = await kbSearch(args.query as string, args.tag as string | undefined);
        break;
      case 'kb_add':
        result = await kbAdd(args.title as string, args.content as string, args.tags as string[] | undefined, args.sourceType as string | undefined);
        break;
      case 'task_create':
        result = await taskCreate(args.name as string, args.description as string | undefined, args.taskType as string, args.schedule as string, args.payload as Record<string, unknown> | undefined);
        break;
      case 'learn_create':
        result = await learnCreate('system', args.title as string, args.content as string, (args.tags as string[]) || []);
        break;
      case 'learn_search':
        result = await learnSearch('system', args.query as string);
        break;
      case 'learn_list':
        result = await learnList('system', (args.limit as number) || 20);
        break;
      case 'graphify_search':
        result = await graphifySearch(args.query as string);
        break;
      case 'graphify_query':
        result = await graphifyQuery(args.question as string);
        break;
      case 'task_list':
        result = await taskList(args.limit as number | undefined);
        break;
      case 'task_delete':
        result = await taskDelete(args.taskId as string);
        break;
      case 'workflow_create':
        result = await workflowCreate(args.name as string, args.description as string | undefined, args.steps as Array<Record<string, unknown>>);
        break;
      case 'workflow_run':
        result = await workflowRun(args.workflowId as string, args.input as string | undefined);
        break;
      case 'workflow_status':
        result = await workflowStatus(args.runId as string);
        break;
      case 'lark_send_message':
        result = await larkSendMessage(args.appId as string, args.receiveId as string, args.message as string, args.receiveIdType as string | undefined);
        break;
      case 'error_logs_search':
        result = await errorLogsSearch(args.table as string | undefined, args.query as string | undefined, args.severity as string | undefined, args.limit as number | undefined);
        break;
      case 'metrics_query':
        result = await metricsQuery(args.name as string, args.from as string | undefined, args.to as string | undefined, args.agg as string | undefined);
        break;
      case 'report_generate':
        result = await reportGenerate(args.reportId as string);
        break;
      case 'report_list':
        result = await reportList(args.limit as number | undefined);
        break;
      case 'analytics_query':
        result = await analyticsQuery();
        break;
      case 'workflow_template_list':
        result = await workflowTemplateList(args.limit as number | undefined);
        break;
      case 'plugin_list':
        result = await pluginList(args.limit as number | undefined);
        break;
      case 'plugin_info':
        result = await pluginInfo(args.pluginId as string);
        break;
      case 'lark_bitable_tables':
        result = await larkBitableTables(args.appToken as string, context?.appId);
        break;
      case 'lark_bitable_list':
        result = await larkBitableList(args.appToken as string, args.tableId as string, args.filter as string | undefined);
        break;
      case 'lark_bitable_create':
        result = await larkBitableCreate(args.appToken as string, args.tableId as string, args.fields as Record<string, unknown>);
        break;
      case 'lark_bitable_batch_create':
        result = await larkBitableBatchCreate(args.appToken as string, args.tableId as string, args.records as Array<{ fields: Record<string, unknown> }>);
        break;
      case 'lark_bitable_batch_update':
        result = await larkBitableBatchUpdate(args.appToken as string, args.tableId as string, args.records as Array<{ record_id: string; fields: Record<string, unknown> }>);
        break;
      case 'lark_bitable_batch_delete':
        result = await larkBitableBatchDelete(args.appToken as string, args.tableId as string, args.recordIds as string[]);
        break;
      case 'lark_search_user':
        result = await larkSearchUser(args.query as string, args.excludeExternal as boolean | undefined, context?.appId);
        break;
      case 'lark_calendar_events':
        result = await larkCalendarEvents(args.calendarId as string, args.startTime as string | undefined, args.endTime as string | undefined, context?.appId);
        break;
      case 'lark_calendar_create':
        result = await larkCalendarCreate(args.summary as string, args.startTime as string, args.endTime as string, args.description as string | undefined, args.attendeeIds as string | undefined, context?.appId);
        break;
      case 'lark_calendar_update':
        result = await larkCalendarUpdate(args.eventId as string, args.summary as string | undefined, args.startTime as string | undefined, args.endTime as string | undefined, args.description as string | undefined, args.addAttendees as string | undefined, args.removeAttendees as string | undefined, context?.appId);
        break;
      case 'lark_calendar_delete':
        result = await larkCalendarDelete(args.eventId as string, context?.appId);
        break;
      case 'generate_pdf':
        result = await generatePdf(args.title as string, args.content as string, args.chatId as string | undefined || context?.chatId, context?.appId);
        break;
      case 'google_drive_read':
        result = await googleDriveRead(args.url as string, (args.maxChars as number) || 15000);
        break;
      case 'ms365_email_send':
        result = await ms365EmailSend(args.to as string, args.subject as string, args.body as string);
        break;
      case 'ms365_calendar_list':
        result = await ms365CalendarList();
        break;
      case 'lark_docs_read':
        result = await larkDocsRead(args.documentId as string, context?.appId);
        break;
      case 'lark_docs_create':
        result = await larkDocsCreateDoc(args.title as string, args.folderToken as string | undefined, context?.appId);
        break;
      case 'lark_docs_update':
        result = await larkDocsUpdateDoc(args.documentId as string, args.content as string, args.blockId as string | undefined, context?.appId);
        break;
      case 'lark_wiki_list_spaces':
        result = await larkWikiListSpacesTool(context?.appId);
        break;
      case 'lark_wiki_list_nodes':
        result = await larkWikiListNodesTool(args.spaceId as string, args.parentNodeToken as string | undefined, context?.appId);
        break;
      case 'lark_wiki_get_node':
        result = await larkWikiGetNodeTool(args.token as string, context?.appId);
        break;
      case 'lark_sheets_read':
        result = await larkSheetsRead(args.spreadsheetToken as string, args.sheetId as string | undefined, args.range as string | undefined, context?.appId);
        break;
      case 'lark_sheets_write':
        result = await larkSheetsWrite(args.spreadsheetToken as string, args.range as string, args.values as string[][], context?.appId);
        break;
      case 'lark_sheets_create':
        result = await larkSheetsCreate(args.title as string, context?.appId);
        break;
      case 'lark_sheets_info':
        result = await larkSheetsInfo(args.spreadsheetToken as string, context?.appId);
        break;
      case 'lark_task_create':
        result = await larkTaskCreate(args.title as string, args.description as string | undefined, args.dueDate as string | undefined, args.assigneeIds as string | undefined, context?.appId);
        break;
      case 'lark_task_list':
        result = await larkTaskList(context?.appId);
        break;
      case 'lark_task_complete':
        result = await larkTaskComplete(args.taskId as string, context?.appId);
        break;
      case 'lark_task_search':
        result = await larkTaskSearch(args.query as string, context?.appId);
        break;
      case 'lark_approval_list':
        result = await larkApprovalList(context?.appId);
        break;
      case 'lark_approval_approve':
        result = await larkApprovalApprove(args.instanceId as string, args.taskId as string, args.comment as string | undefined, context?.appId);
        break;
      case 'lark_approval_reject':
        result = await larkApprovalReject(args.instanceId as string, args.taskId as string, args.comment as string | undefined, context?.appId);
        break;
      case 'lark_drive_search':
        result = await larkDriveSearch(args.query as string, context?.appId);
        break;
      case 'lark_drive_upload':
        result = await larkDriveUpload(args.filePath as string, args.folderToken as string | undefined, context?.appId);
        break;
      case 'lark_drive_download':
        result = await larkDriveDownload(args.fileToken as string, args.outputPath as string | undefined, context?.appId);
        break;
      case 'lark_drive_create_folder':
        result = await larkDriveCreateFolder(args.name as string, args.folderToken as string | undefined, context?.appId);
        break;
      case 'lark_vc_search':
        result = await larkVcSearch(args.query as string, args.startTime as string | undefined, args.endTime as string | undefined, context?.appId);
        break;
      case 'lark_vc_list_active':
        result = await larkVcListActive(context?.appId);
        break;
      case 'lark_vc_notes':
        result = await larkVcNotes(args.meetingId as string, context?.appId);
        break;
      case 'lark_message_search':
        result = await larkMessageSearch(args.query as string, args.chatId as string | undefined, args.startTime as string | undefined, args.endTime as string | undefined, context?.appId);
        break;
      case 'lark_message_send':
        result = await larkMessageSendTool(args.chatId as string, args.content as string, args.msgType as string | undefined, context?.appId);
        break;
      case 'lark_group_list':
        result = await larkGroupList(context?.appId);
        break;
      case 'lark_group_create':
        result = await larkGroupCreate(args.name as string, args.description as string | undefined, args.memberIds as string | undefined, context?.appId);
        break;
      case 'lark_group_members':
        result = await larkGroupMembers(args.chatId as string, context?.appId);
        break;
      case 'ms365_calendar_create':
        result = await ms365CalendarCreate(args.subject as string, args.start as string, args.end as string, args.attendees as string[] | undefined);
        break;
      // GOR-139: GitHub tools
      case 'github_list_repos':
        result = await githubListRepos(context?.userId, args.per_page as number | undefined);
        break;
      case 'github_list_issues':
        result = await githubListIssues(context?.userId, args.owner as string, args.repo as string, args.state as string | undefined);
        break;
      case 'github_create_issue':
        result = await githubCreateIssue(context?.userId, args.owner as string, args.repo as string, args.title as string, args.body as string | undefined, args.labels as string[] | undefined);
        break;
      case 'github_list_prs':
        result = await githubListPRs(context?.userId, args.owner as string, args.repo as string, args.state as string | undefined);
        break;
      case 'github_list_workflows':
        result = await githubListWorkflows(context?.userId, args.owner as string, args.repo as string);
        break;
      case 'github_get_file':
        result = await githubGetFile(context?.userId, args.owner as string, args.repo as string, args.path as string, args.ref as string | undefined);
        break;
      case 'github_create_file':
        result = await githubCreateFile(context?.userId, args.owner as string, args.repo as string, args.path as string, args.content as string, args.message as string, args.branch as string | undefined);
        break;
      // GOR-140: Notion tools
      case 'notion_search':
        result = await notionSearch(context?.userId, args.query as string | undefined);
        break;
      case 'notion_get_page':
        result = await notionGetPage(context?.userId, args.pageId as string);
        break;
      case 'notion_create_page':
        result = await notionCreatePage(context?.userId, args.databaseId as string, args.properties as Record<string, unknown>);
        break;
      case 'notion_list_databases':
        result = await notionListDatabases(context?.userId);
        break;
      case 'notion_query_database':
        result = await notionQueryDatabase(context?.userId, args.databaseId as string, args.filter);
        break;
      // GOR-140: Slack tools
      case 'slack_list_channels':
        result = await slackListChannels(context?.userId);
        break;
      case 'slack_send_message':
        result = await slackSendMessageTool(context?.userId, args.channel as string, args.text as string);
        break;
      case 'slack_search_messages':
        result = await slackSearchMessages(context?.userId, args.query as string);
        break;
      // GOR-140: Airtable tools
      case 'airtable_list_bases':
        result = await airtableListBases(context?.userId);
        break;
      case 'airtable_list_records':
        result = await airtableListRecords(context?.userId, args.baseId as string, args.tableId as string, args.maxRecords as number | undefined);
        break;
      case 'airtable_create_record':
        result = await airtableCreateRecordTool(context?.userId, args.baseId as string, args.tableId as string, args.fields as Record<string, unknown>);
        break;
      default:
        return { success: false, output: `Unknown tool: ${name}`, executionTimeMs: Date.now() - startTime };
    }

    return { success: true, output: result, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return { success: false, output: `Error executing ${name}: ${String(e)}`, executionTimeMs: Date.now() - startTime };
  }
}

// === Built-in Tool Implementations ===

async function webSearch(query: string, maxResults = 5): Promise<string> {
  try {
    // DuckDuckGo Lite — scrape HTML for real search results
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const html = await res.text();

    // Extract result snippets from DDG Lite HTML
    const results: { title: string; snippet: string; url: string }[] = [];

    // DDG Lite uses <a class="result-link"> for titles and <td class="result-snippet"> for snippets
    const linkRegex = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
    const snippetRegex = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

    const links: { url: string; title: string }[] = [];
    let m;
    while ((m = linkRegex.exec(html)) !== null) {
      links.push({ url: m[1], title: m[2].trim() });
    }

    const snippets: string[] = [];
    while ((m = snippetRegex.exec(html)) !== null) {
      const text = m[1].replace(/<[^>]+>/g, '').trim();
      if (text) snippets.push(text);
    }

    for (let i = 0; i < Math.min(links.length, maxResults); i++) {
      results.push({
        title: links[i].title,
        snippet: snippets[i] || '',
        url: links[i].url
      });
    }

    if (results.length === 0) {
      // Fallback: DuckDuckGo Instant Answer API
      const instantRes = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
      const data = await instantRes.json();
      const fallback: string[] = [];
      if (data.Abstract) fallback.push(data.Abstract);
      if (data.Answer) fallback.push(`Answer: ${data.Answer}`);
      data.RelatedTopics?.slice(0, 5).forEach((t: any) => {
        if (t.Text) fallback.push(`• ${t.Text}`);
      });
      if (fallback.length > 0) return fallback.join('\n\n');
      return `No results found for "${query}". Try a more specific search.`;
    }

    return results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`).join('\n\n');
  } catch {
    // Fallback: DuckDuckGo Instant Answer API
    try {
      const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
      const data = await res.json();
      const results: string[] = [];
      if (data.Abstract) results.push(data.Abstract);
      if (data.Answer) results.push(`Answer: ${data.Answer}`);
      data.RelatedTopics?.slice(0, 5).forEach((t: any) => {
        if (t.Text) results.push(`• ${t.Text}`);
      });
      return results.length > 0 ? results.join('\n\n') : `Search unavailable`;
    } catch {
      return `Search unavailable (network error)`;
    }
  }
}

async function webFetch(url: string, maxChars = 10000): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,text/plain,application/json,*/*'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) return `Error: HTTP ${res.status} ${res.statusText}`;

    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    // GOR-111: Use Cheerio for HTML parsing — much cleaner than regex
    let content = text;
    if (contentType.includes('html')) {
      const { load } = await import('cheerio');
      const $ = load(text);
      
      // Remove noise elements
      $('script, style, nav, footer, header, aside, iframe, noscript, svg').remove();
      $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove();
      $('.ad, .ads, .advertisement, .sidebar, .menu, .cookie-banner, .popup').remove();
      
      // Extract main content area or fall back to body
      const mainContent = $('main, article, [role="main"], .content, .post-content, .entry-content').first();
      const target = mainContent.length ? mainContent : $('body');
      
      // Get text with proper spacing
      content = target.text()
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();
      
      // Extract title
      const title = $('title').text().trim();
      if (title) content = `Title: ${title}\n\n${content}`;
    }

    if (content.length > maxChars) {
      content = content.slice(0, maxChars) + `\n\n... (truncated, ${text.length} total chars)`;
    }

    return content;
  } catch (e: any) {
    if (e.name === 'AbortError') return 'Error: Request timed out (15s)';
    return `Error fetching URL: ${e.message}`;
  }
}

function calculator(expression: string): string {
  try {
    // Safe math evaluation — only allow numbers, operators, parens, spaces
    if (!/^[\d+\-*/().%\s]+$/.test(expression)) {
      return 'Error: Only numeric expressions allowed';
    }
    // eslint-disable-next-line no-eval
    const result = Function('"use strict"; return (' + expression + ')')();
    return `= ${result}`;
  } catch {
    return 'Error: Invalid expression';
  }
}

async function noteCreate(title: string, content: string, tags?: string[]): Promise<string> {
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO notes (id, title, content, tags) VALUES ($1, $2, $3, $4)",
    [id, title, content, tags || []]
  );
  return `Note created: "${title}" (id: ${id})`;
}

async function noteSearch(searchQuery: string): Promise<string> {
  const rows = await getMany<{ title: string; content: string; tags: string[] }>(
    "SELECT title, content, tags FROM notes WHERE title ILIKE $1 OR content ILIKE $1 ORDER BY updated_at DESC LIMIT 5",
    [`%${searchQuery}%`]
  );
  if (rows.length === 0) return `No notes found for "${searchQuery}"`;
  return rows.map(r => `📝 ${r.title}: ${r.content.slice(0, 200)}${r.content.length > 200 ? '...' : ''}`).join('\n');
}

async function noteList(limit?: number): Promise<string> {
  const rows = await getMany<{ title: string; tags: string[] }>(
    "SELECT title, tags FROM notes ORDER BY updated_at DESC LIMIT $1",
    [limit || 10]
  );
  if (rows.length === 0) return 'No notes yet.';
  return rows.map(r => `📝 ${r.title} [${r.tags?.join(', ') || ''}]`).join('\n');
}

function currentTime(timezone?: string): string {
  const tz = timezone || 'Asia/Jakarta';
  return new Date().toLocaleString('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' });
}

async function memoryGet(namespace: string | undefined, key: string): Promise<string> {
  const ns = namespace || 'default';
  const row = await getOne<{ value: unknown }>(
    "SELECT value FROM agent_memory WHERE user_id IS NOT NULL AND namespace = $1 AND key = $2",
    [ns, key]
  );
  if (!row) return `No memory found for key "${key}" in namespace "${ns}"`;
  return typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
}

async function memorySet(namespace: string | undefined, key: string, value: unknown): Promise<string> {
  const ns = namespace || 'default';
  // Note: user_id is set at the chat route level, so this uses a system-wide approach
  // For now, we store without user_id (global memory)
  await query(
    `INSERT INTO agent_memory (user_id, namespace, key, value) VALUES ('system', $1, $2, $3)
     ON CONFLICT (user_id, namespace, key) DO UPDATE SET value = $3, updated_at = now()`,
    [ns, key, JSON.stringify(value)]
  );
  return `Memory stored: ${ns}/${key}`;
}

async function kbSearch(searchQuery: string, tag?: string): Promise<string> {
  // Search knowledge_notes (the single source of truth)
  let sql = 'SELECT title, content, tags FROM knowledge_notes WHERE (title ILIKE $1 OR content ILIKE $1)';
  const params: unknown[] = [`%${searchQuery}%`];
  if (tag) {
    sql += ' AND $2 = ANY(tags)';
    params.push(tag);
  }
  sql += ' ORDER BY updated_at DESC LIMIT 10';
  const rows = await getMany<{ title: string; content: string; tags: string[] }>(sql, params);
  if (rows.length === 0) return `No knowledge base entries found for "${searchQuery}"`;
  return rows.map(r => `📚 ${r.title}: ${r.content.slice(0, 200)}${r.content.length > 200 ? '...' : ''} [${r.tags?.join(', ') || ''}]`).join('\n');
}

async function kbAdd(title: string, content: string, tags?: string[], sourceType?: string): Promise<string> {
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO knowledge_notes (id, user_id, source_type, title, content, tags) VALUES ($1, 'system', $2, $3, $4, $5)",
    [id, sourceType || 'document', title, content, tags || []]
  );
  return `Knowledge base entry created: "${title}" (id: ${id})`;
}

// === Scheduled Task Tools ===

async function learnCreate(userId: string, title: string, content: string, tags: string[]): Promise<string> {
  try {
    const { createNote } = await import('@/lib/learning');
    const note = await createNote(userId, title, content, tags, 'bot');
    return `✅ Note saved: "${note.title}" (id: ${note.id})`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function learnSearch(userId: string, query: string): Promise<string> {
  try {
    const { searchNotes } = await import('@/lib/learning');
    const notes = await searchNotes(userId, query);
    if (notes.length === 0) return `No notes found for "${query}".`;
    return notes.map((n: Record<string, unknown>, i: number) => `${i+1}. [${n.title}] ${(n.content as string).slice(0,100)}...`).join('\n');
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function learnList(userId: string, limit: number): Promise<string> {
  try {
    const { listNotes } = await import('@/lib/learning');
    const notes = await listNotes(userId, limit);
    if (notes.length === 0) return 'No notes yet.';
    return notes.map((n: Record<string, unknown>, i: number) => `${i+1}. ${n.title} [${(n.tags as string[])?.join(', ') || ''}]`).join('\n');
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function graphifySearch(query: string): Promise<string> {
  try {
    const { searchNodes } = await import('@/lib/graphify');
    const nodes = searchNodes(query, 10);
    if (nodes.length === 0) return `No nodes found matching "${query}" in the codebase graph.`;
    return nodes.map((n: any) => `🔍 ${n.label} (community ${n.community}) — ${n.source_file || 'unknown'}`).join('\n');
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function graphifyQuery(question: string): Promise<string> {
  try {
    const { queryGraph } = await import('@/lib/graphify');
    return queryGraph(question);
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function taskCreate(name: string, description: string | undefined, taskType: string, schedule: string, payload?: Record<string, unknown>): Promise<string> {
  const nextRun = taskType === 'interval' ? new Date(Date.now() + parseInt(schedule, 10)) : new Date(Date.now() + 60_000);
  const row = await getOne<{ id: string }>(
    `INSERT INTO scheduled_tasks (user_id, name, description, task_type, schedule, payload, enabled, next_run_at)
     VALUES ('system', $1, $2, $3, $4, $5, true, $6) RETURNING id`,
    [name, description || null, taskType, schedule, JSON.stringify(payload || {}), nextRun]
  );
  return `Scheduled task "${name}" created (id: ${row?.id}). Type: ${taskType}, Schedule: ${schedule}`;
}

async function taskList(limit?: number): Promise<string> {
  const rows = await getMany<{ id: string; name: string; task_type: string; schedule: string; enabled: boolean; last_run_at: string | null; next_run_at: string | null }>(
    'SELECT id, name, task_type, schedule, enabled, last_run_at, next_run_at FROM scheduled_tasks ORDER BY created_at DESC LIMIT $1',
    [limit || 10]
  );
  if (rows.length === 0) return 'No scheduled tasks.';
  return rows.map(r => `⏰ ${r.name} [${r.task_type}] ${r.schedule} ${r.enabled ? '✅' : '⏸️'} last: ${r.last_run_at || 'never'} next: ${r.next_run_at || 'n/a'}`).join('\n');
}

async function taskDelete(taskId: string): Promise<string> {
  const result = await query('DELETE FROM scheduled_tasks WHERE id = $1', [taskId]);
  if (result.rowCount === 0) return `Task not found: ${taskId}`;
  return `Task ${taskId} deleted.`;
}

// === Workflow Tools ===

async function workflowCreate(name: string, description: string | undefined, steps: Array<Record<string, unknown>>): Promise<string> {
  const row = await getOne<{ id: string }>(
    `INSERT INTO workflows (user_id, name, description, steps) VALUES ('system', $1, $2, $3) RETURNING id`,
    [name, description || null, JSON.stringify(steps)]
  );
  return `Workflow "${name}" created (id: ${row?.id}) with ${steps.length} steps.`;
}

async function workflowRun(workflowId: string, input?: string): Promise<string> {
  const wf = await getOne<{ id: string; name: string; steps: Array<Record<string, unknown>>; enabled: boolean }>(
    'SELECT id, name, steps, enabled FROM workflows WHERE id = $1', [workflowId]
  );
  if (!wf) return `Workflow not found: ${workflowId}`;
  if (!wf.enabled) return `Workflow "${wf.name}" is disabled.`;

  const run = await getOne<{ id: string }>(
    `INSERT INTO workflow_runs (workflow_id, user_id, status, context) VALUES ($1, 'system', 'RUNNING', $2) RETURNING id`,
    [workflowId, JSON.stringify({ input: input || '' })]
  );
  return `Workflow "${wf.name}" run started (runId: ${run?.id}). Use workflow_status to check progress.`;
}

async function workflowStatus(runId: string): Promise<string> {
  const run = await getOne<{ id: string; status: string; current_step: number; output: string | null; created_at: string; completed_at: string | null }>(
    'SELECT id, status, current_step, output, created_at, completed_at FROM workflow_runs WHERE id = $1', [runId]
  );
  if (!run) return `Workflow run not found: ${runId}`;
  return `Run ${runId}: status=${run.status}, step=${run.current_step}, started=${run.created_at}${run.completed_at ? ', completed=' + run.completed_at : ''}${run.output ? ', output=' + run.output.slice(0, 200) : ''}`;
}

// === Lark Tool ===

async function larkSendMessage(appId: string, receiveId: string, message: string, receiveIdType?: string): Promise<string> {
  const config = await getOne<{ app_secret: string }>(
    'SELECT app_secret FROM lark_config WHERE app_id = $1 AND enabled = true', [appId]
  );
  if (!config) return `Lark config not found for app_id: ${appId}`;

  const { sendLarkMessage } = await import('./lark');
  const result = await sendLarkMessage(
    appId, config.app_secret, receiveId, 'text',
    JSON.stringify({ text: message }),
    (receiveIdType as 'open_id' | 'user_id' | 'chat_id') || 'open_id'
  );

  if (!result.ok) return `Failed to send Lark message: ${result.error}`;
  return `Lark message sent (message_id: ${result.message_id})`;
}

// === Error & Monitoring Tools ===

async function errorLogsSearch(table: string | undefined, searchQuery: string | undefined, severity: string | undefined, limit?: number): Promise<string> {
  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let idx = 1;
  if (severity) { where += ` AND severity = $${idx++}`; params.push(severity); }
  if (searchQuery) { where += ` AND (message ILIKE $${idx} OR source ILIKE $${idx})`; params.push(`%${searchQuery}%`); idx++; }
  const rows = await getMany(
    `SELECT id, severity, source, message, created_at, resolved FROM error_logs ${where} ORDER BY created_at DESC LIMIT $${idx}`,
    [...params, limit || 10]
  );
  if (rows.length === 0) return 'No error logs found.';
  return rows.map((r: any) => `${r.resolved ? '✅' : '❌'} [${r.severity}] ${r.source}: ${r.message?.slice(0, 100)} (${r.created_at})`).join('\n');
}

async function metricsQuery(name: string, from?: string, to?: string, agg?: string): Promise<string> {
  const fn = ['avg', 'count', 'min', 'max', 'sum'].includes(agg || '') ? agg : 'avg';
  const fnMap: Record<string, string> = { avg: 'AVG', count: 'COUNT(*)', min: 'MIN', max: 'MAX', sum: 'SUM' };
  let where = 'WHERE metric_name = $1';
  const params: unknown[] = [name];
  let idx = 2;
  if (from) { where += ` AND recorded_at >= $${idx++}`; params.push(from); }
  if (to) { where += ` AND recorded_at <= $${idx++}`; params.push(to); }
  const result = await getOne<{ value: number }>(
    `SELECT ${fnMap[fn!]}(metric_value)::numeric as value FROM metrics ${where}`, params
  );
  const count = await getOne<{ count: number }>(
    `SELECT COUNT(*)::int as count FROM metrics ${where}`, params
  );
  return `Metric: ${name}\nAggregation: ${fn}\nValue: ${result?.value || 0}\nData points: ${count?.count || 0}`;
}

async function reportGenerate(reportId: string): Promise<string> {
  const report = await getOne<{ id: string; name: string; report_type: string; config: any }>(
    'SELECT * FROM reports WHERE id = $1', [reportId]
  );
  if (!report) return `Report not found: ${reportId}`;
  const interval = report.config?.timeRange === '7d' ? '7 days' : report.config?.timeRange === '30d' ? '30 days' : '24 hours';
  const history = await getOne<{ id: string }>(
    `INSERT INTO report_history (report_id, user_id, status) VALUES ($1, 'system', 'generating') RETURNING id`, [reportId]
  );
  try {
    let data: unknown;
    if (report.report_type === 'usage') {
      const chatsPerDay = await getMany(`SELECT date(created_at) as date, COUNT(*)::int as count FROM messages WHERE role = 'USER' AND created_at >= now() - interval '${interval}' GROUP BY date(created_at) ORDER BY date`, []);
      data = { chatsPerDay };
    } else if (report.report_type === 'activity') {
      const convs = await getOne(`SELECT COUNT(*)::int as count FROM conversations WHERE created_at >= now() - interval '${interval}'`, []);
      const msgs = await getOne(`SELECT COUNT(*)::int as count FROM messages WHERE created_at >= now() - interval '${interval}'`, []);
      data = { conversations: convs?.count || 0, messages: msgs?.count || 0 };
    } else {
      data = { message: 'Report type not implemented' };
    }
    await query(`UPDATE report_history SET status = 'completed', output_data = $1 WHERE id = $2`, [JSON.stringify(data), history!.id]);
    return `Report "${report.name}" generated. History ID: ${history!.id}`;
  } catch (e) {
    await query(`UPDATE report_history SET status = 'failed', error = $1 WHERE id = $2`, [String(e), history!.id]);
    return `Report generation failed: ${String(e)}`;
  }
}

async function reportList(limit?: number): Promise<string> {
  const rows = await getMany<{ id: string; name: string; report_type: string; last_generated_at: string | null }>(
    'SELECT id, name, report_type, last_generated_at FROM reports ORDER BY created_at DESC LIMIT $1', [limit || 10]
  );
  if (rows.length === 0) return 'No reports defined.';
  return rows.map(r => `📊 ${r.name} [${r.report_type}] last: ${r.last_generated_at || 'never'}`).join('\n');
}

async function analyticsQuery(): Promise<string> {
  const todayMsgs = await getOne<{ count: number }>("SELECT COUNT(*)::int as count FROM messages WHERE created_at >= date_trunc('day', now())", []);
  const todayRuns = await getOne<{ count: number }>("SELECT COUNT(*)::int as count FROM agent_runs WHERE created_at >= date_trunc('day', now())", []);
  const todayErrs = await getOne<{ count: number }>("SELECT COUNT(*)::int as count FROM error_logs WHERE created_at >= date_trunc('day', now())", []);
  const activeUsers = await getOne<{ count: number }>("SELECT COUNT(DISTINCT user_id)::int as count FROM conversations WHERE updated_at >= now() - interval '7 days'", []);
  return `Analytics Dashboard (Today)\nMessages: ${todayMsgs?.count || 0}\nAgent Runs: ${todayRuns?.count || 0}\nErrors: ${todayErrs?.count || 0}\nActive Users (7d): ${activeUsers?.count || 0}`;
}

// === Lark Full API Tools ===

async function larkBitableTables(appToken: string, appId?: string): Promise<string> {
  try {
    const { larkBitableListTables, larkBitableListFields } = await import('@/lib/lark-api');
    const data = await larkBitableListTables(appToken) as { items?: Record<string, unknown>[] };
    const tables = data.items || [];
    if (tables.length === 0) return 'No tables found in this Bitable.';
    let output = `Found ${tables.length} table(s):\n\n`;
    for (const tbl of tables) {
      const tid = tbl.table_id as string;
      const name = tbl.name as string || tid;
      output += `📋 ${name} (tableId: ${tid})\n`;
      try {
        const fieldsData = await larkBitableListFields(appToken, tid) as { items?: Record<string, unknown>[] };
        const fields = fieldsData.items || [];
        if (fields.length > 0) {
          output += `   Fields: ${fields.map(f => `${f.field_name}(${f.type})`).join(', ')}\n`;
        }
      } catch { /* skip fields */ }
    }
    return output;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkBitableList(appToken: string, tableId: string, filter?: string): Promise<string> {
  try {
    const { larkBitableListRecords } = await import('@/lib/lark-api');
    const data = await larkBitableListRecords(appToken, tableId, filter) as { items?: Record<string, unknown>[] };
    const items = data.items || [];
    if (items.length === 0) return 'No records found.';
    return items.map((r, i) => `${i + 1}. ${JSON.stringify(r.fields || {})}`).join('\n');
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkBitableCreate(appToken: string, tableId: string, fields: Record<string, unknown>): Promise<string> {
  try {
    const { larkBitableCreateRecord } = await import('@/lib/lark-api');
    const data = await larkBitableCreateRecord(appToken, tableId, fields) as { record?: { record_id: string } };
    return `Record created: ${data.record?.record_id || JSON.stringify(data)}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

// GOR-127: Bitable bulk operations
async function larkBitableBatchCreate(appToken: string, tableId: string, records: Array<{ fields: Record<string, unknown> }>): Promise<string> {
  try {
    const { larkBitableBatchCreate } = await import('@/lib/lark-api');
    const data = await larkBitableBatchCreate(appToken, tableId, records) as { records?: Array<{ record_id: string }> };
    return `✅ Batch created ${data.records?.length || 0} records.`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkBitableBatchUpdate(appToken: string, tableId: string, records: Array<{ record_id: string; fields: Record<string, unknown> }>): Promise<string> {
  try {
    const { larkBitableBatchUpdate } = await import('@/lib/lark-api');
    const data = await larkBitableBatchUpdate(appToken, tableId, records) as { records?: Array<{ record_id: string }> };
    return `✅ Batch updated ${data.records?.length || 0} records.`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkBitableBatchDelete(appToken: string, tableId: string, recordIds: string[]): Promise<string> {
  try {
    const { larkBitableBatchDelete } = await import('@/lib/lark-api');
    await larkBitableBatchDelete(appToken, tableId, recordIds);
    return `✅ Batch deleted ${recordIds.length} records.`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkSearchUser(query: string, excludeExternal?: boolean, appId?: string): Promise<string> {
  try {
    if (!query) return 'Error: query is required.';
    // Try lark-cli first (has stored user token), fallback to DB
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';
    try {
      let cmd = `lark-cli ${profileFlag} contact +search-user --as user --query "${query.replace(/"/g, '\\"')}"`;
      if (excludeExternal) cmd += ' --exclude-external-users';
      const { stdout } = await execAsync(cmd, { cwd: '/home/ubuntu/apps/agentic-os' });
      const result = JSON.parse(stdout);
      if (result.ok) {
        const users = result.data?.users || [];
        if (users.length === 0) return `No users found for "${query}".`;
        return users.map((u: any) => `${u.name || u.localized_name || u.en_name || 'Unknown'} (open_id: ${u.open_id})`).join('\n');
      }
    } catch {}

    // Fallback to DB token
    const token = await getLarkUserTokenFromDB();
    if (!token) return 'Error: No Lark user token. Please authorize first.';
    const url = new URL('https://open.larksuite.com/open-apis/search/v1/user');
    url.searchParams.set('query', query);
    url.searchParams.set('page_size', '20');
    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (data.code !== 0) return `Error searching users: ${data.msg || 'unknown'}`;
    const users = data.data?.users || [];
    if (users.length === 0) return `No users found for "${query}".`;
    return users.map((u: any) => `${u.name || u.localized_name || u.en_name || 'Unknown'} (open_id: ${u.open_id})`).join('\n');
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}



async function larkCalendarEvents(calendarId?: string, startTime?: string, endTime?: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';

    // Resolve calendar_id if not provided
    let resolvedCalId = calendarId;
    if (!resolvedCalId || resolvedCalId === 'primary') {
      const listResult = await execAsync(`lark-cli ${profileFlag} calendar calendars list`, { cwd: '/home/ubuntu/apps/agentic-os' });
      const parsed = JSON.parse(listResult.stdout);
      if (parsed?.data?.calendar_list?.[0]?.calendar_id) {
        resolvedCalId = parsed.data.calendar_list[0].calendar_id;
      }
    }

    // Default time range
    const now = Math.floor(Date.now() / 1000);
    const start = startTime ? Math.floor(new Date(startTime).getTime() / 1000) : now - 86400;
    const end = endTime ? Math.floor(new Date(endTime).getTime() / 1000) : now + 86400 * 7;

    const cmd = `lark-cli ${profileFlag} calendar events instance_view --params ${JSON.stringify(JSON.stringify({calendar_id: resolvedCalId, start_time: String(start), end_time: String(end)}))}`;
    const { stdout } = await execAsync(cmd, { cwd: '/home/ubuntu/apps/agentic-os', maxBuffer: 10 * 1024 * 1024 });
    const result = JSON.parse(stdout);
    const items = (result?.data?.items || []).filter((e: Record<string, unknown>) => e.status !== 'cancelled');
    if (items.length === 0) return 'No events found for this time range.';
    return items.map((e: Record<string, unknown>, i: number) => {
      const start = e.start_time as Record<string, unknown> | undefined;
      const ts = start?.timestamp ? Number(start.timestamp) * 1000 : 0;
      const startStr = ts ? new Date(ts).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) : '?';
      const eventId = e.event_id || '?';
      return `${i + 1}. ${e.summary || 'No title'} - ${startStr} WIB (event_id: ${eventId})${e.vchat ? ' (VC: ' + (e.vchat as Record<string, unknown>).meeting_url + ')' : ''}`;
    }).join('\n');
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

// === MS365 Tools ===

async function larkCalendarCreate(summary: string, startTime: string, endTime: string, description?: string, attendeeIds?: string, appId?: string): Promise<string> {
  try {
    if (!summary || !startTime || !endTime) return 'Error: summary, startTime, endTime are required.';
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';
    let cmd = `lark-cli ${profileFlag} calendar +create --as user --start "${startTime}" --end "${endTime}" --summary "${summary.replace(/"/g, '\\"')}"`;
    if (description) cmd += ` --description "${description.replace(/"/g, '\\"')}"`;
    if (attendeeIds) cmd += ` --attendee-ids "${attendeeIds}"`;
    const { stdout } = await execAsync(cmd, { cwd: '/home/ubuntu/apps/agentic-os' });
    const result = JSON.parse(stdout);
    if (!result.ok) return `Error creating event: ${result.error?.message || 'unknown'}`;
    const ev = result.data?.event || result.data;
    return `Event created: ${ev.summary || summary} (event_id: ${ev.event_id || '?'})`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkCalendarUpdate(eventId: string, summary?: string, startTime?: string, endTime?: string, description?: string, addAttendees?: string, removeAttendees?: string, appId?: string): Promise<string> {
  try {
    if (!eventId) return 'Error: eventId is required.';
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';
    let cmd = `lark-cli ${profileFlag} calendar +update --as user --event-id "${eventId}"`;
    if (summary) cmd += ` --summary "${summary.replace(/"/g, '\\"')}"`;
    if (startTime) cmd += ` --start "${startTime}"`;
    if (endTime) cmd += ` --end "${endTime}"`;
    if (description) cmd += ` --description "${description.replace(/"/g, '\\"')}"`;
    if (addAttendees) cmd += ` --add-attendee-ids "${addAttendees}"`;
    if (removeAttendees) cmd += ` --remove-attendee-ids "${removeAttendees}"`;
    const { stdout } = await execAsync(cmd, { cwd: '/home/ubuntu/apps/agentic-os' });
    const result = JSON.parse(stdout);
    if (!result.ok) return `Error updating event: ${result.error?.message || 'unknown'}`;
    return `Event updated: ${eventId}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkCalendarDelete(eventId: string, appId?: string): Promise<string> {
  try {
    if (!eventId) return 'Error: eventId is required.';
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';
    
    // Check event status first
    try {
      const { stdout: statusOut } = await execAsync(`lark-cli ${profileFlag} calendar events get --as user --event-id "${eventId}" --calendar-id primary`, { cwd: '/home/ubuntu/apps/agentic-os' });
      const statusResult = JSON.parse(statusOut);
      if (statusResult?.data?.event?.status === 'cancelled') {
        return `Event ${eventId} is already cancelled. No action needed.`;
      }
    } catch { /* proceed with delete attempt */ }

    const { stdout } = await execAsync(`lark-cli ${profileFlag} calendar events delete --as user --event-id "${eventId}" --calendar-id primary`, { cwd: '/home/ubuntu/apps/agentic-os' });
    const result = JSON.parse(stdout);
    if (!result.ok) {
      // Handle specific error codes
      if (result.error?.code === 10012 || String(result.error?.message || '').includes('not found') || String(result.error?.message || '').includes('cancelled')) {
        return `Event ${eventId} may already be cancelled or deleted. No action needed.`;
      }
      return `Error deleting event: ${result.error?.message || 'unknown'}`;
    }
    return `Event deleted: ${eventId}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

// === Lark Docs Tool Implementations ===

async function larkDocsRead(documentId: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';

    // Get raw content via lark-cli api
    const { stdout } = await execAsync(
      `lark-cli ${profileFlag} api GET /docx/v1/documents/${documentId}/raw_content --as user --json`,
      { cwd: '/home/ubuntu/apps/agentic-os', maxBuffer: 10 * 1024 * 1024 }
    );
    const result = JSON.parse(stdout);
    if (result.code !== 0) return `Error reading document: ${result.msg || 'unknown'}`;
    const content = result.data?.content || '';
    if (!content) return `Document ${documentId} is empty or inaccessible.`;
    // Truncate for LLM context
    const truncated = content.length > 15000 ? content.slice(0, 15000) + '\n\n[...truncated]' : content;
    return truncated;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkDocsCreateDoc(title: string, folderToken?: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';

    const body: Record<string, unknown> = { title };
    if (folderToken) body.folder_token = folderToken;
    const { stdout } = await execAsync(
      `lark-cli ${profileFlag} api POST /docx/v1/documents --as user --data '${JSON.stringify(body)}' --json`,
      { cwd: '/home/ubuntu/apps/agentic-os' }
    );
    const result = JSON.parse(stdout);
    if (result.code !== 0) return `Error creating document: ${result.msg || 'unknown'}`;
    const doc = result.data?.document || {};
    return `Document created: "${doc.title || title}" (id: ${doc.document_id || 'unknown'}, url: https://open.larksuite.com/docx/${doc.document_id || ''})`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkDocsUpdateDoc(documentId: string, content: string, blockId?: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';

    // First, get document blocks to find the target block
    const targetBlock = blockId || documentId; // document root block = documentId

    // Create a text block as child of the target
    const blockData = {
      children: [{
        block_type: 2, // text
        text: { elements: [{ text_run: { content } }] }
      }],
      index: -1 // append at end
    };
    const { stdout } = await execAsync(
      `lark-cli ${profileFlag} api POST /docx/v1/documents/${documentId}/blocks/${targetBlock}/children --as user --data '${JSON.stringify(blockData)}' --json`,
      { cwd: '/home/ubuntu/apps/agentic-os' }
    );
    const result = JSON.parse(stdout);
    if (result.code !== 0) return `Error updating document: ${result.msg || 'unknown'}`;
    return `Content added to document ${documentId}. Block ID: ${result.data?.children?.[0]?.block_id || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkWikiListSpacesTool(appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';

    const { stdout } = await execAsync(
      `lark-cli ${profileFlag} wiki space-list --as user --json`,
      { cwd: '/home/ubuntu/apps/agentic-os' }
    );
    const result = JSON.parse(stdout);
    if (result.ok) {
      const spaces = result.data?.items || [];
      if (spaces.length === 0) return 'No wiki spaces found.';
      return spaces.map((s: Record<string, unknown>, i: number) => `${i + 1}. ${s.name || 'Unnamed'} (space_id: ${s.space_id}, desc: ${(s.description || '').toString().slice(0, 50)})`).join('\n');
    }
    // Fallback: raw API
    const { stdout: stdout2 } = await execAsync(
      `lark-cli ${profileFlag} api GET /wiki/v2/spaces --as user --json`,
      { cwd: '/home/ubuntu/apps/agentic-os' }
    );
    const result2 = JSON.parse(stdout2);
    if (result2.code !== 0) return `Error listing wiki spaces: ${result2.msg || 'unknown'}`;
    const spaces2 = result2.data?.items || [];
    if (spaces2.length === 0) return 'No wiki spaces found.';
    return spaces2.map((s: Record<string, unknown>, i: number) => `${i + 1}. ${s.name || 'Unnamed'} (space_id: ${s.space_id})`).join('\n');
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkWikiListNodesTool(spaceId: string, parentNodeToken?: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';

    let cmd = `lark-cli ${profileFlag} wiki node-list --as user --space-id ${spaceId}`;
    if (parentNodeToken) cmd += ` --parent-node-token ${parentNodeToken}`;
    const { stdout } = await execAsync(cmd, { cwd: '/home/ubuntu/apps/agentic-os' });
    const result = JSON.parse(stdout);
    if (result.ok) {
      const nodes = result.data?.items || [];
      if (nodes.length === 0) return 'No wiki nodes found in this space.';
      return nodes.map((n: Record<string, unknown>, i: number) => {
        const type = n.obj_type === 'doc' ? '📄' : n.obj_type === 'sheet' ? '📊' : n.obj_type === 'bitable' ? '🗃️' : '📁';
        return `${i + 1}. ${type} ${n.title || 'Untitled'} (node_token: ${n.node_token}, type: ${n.obj_type})`;
      }).join('\n');
    }
    return `Error listing wiki nodes: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkWikiGetNodeTool(token: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';

    const { stdout } = await execAsync(
      `lark-cli ${profileFlag} wiki node-get --as user --token ${token} --json`,
      { cwd: '/home/ubuntu/apps/agentic-os' }
    );
    const result = JSON.parse(stdout);
    if (result.ok) {
      const node = result.data?.node || {};
      return `Title: ${node.title || 'Untitled'}\nType: ${node.obj_type || 'unknown'}\nToken: ${node.node_token}\nObj Token: ${node.obj_token || 'none'}\nSpace: ${node.space_id || 'unknown'}\nParent: ${node.parent_node_token || 'root'}`;
    }
    return `Error getting wiki node: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkSheetsRead(spreadsheetToken: string, sheetId?: string, range?: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';

    // If no sheetId, get workbook info first
    let targetSheet = sheetId;
    if (!targetSheet) {
      const infoCmd = `lark-cli ${profileFlag} sheets workbook-info --spreadsheet-token ${spreadsheetToken} --as user --json`;
      const infoResult = await execAsync(infoCmd, { cwd: '/home/ubuntu/apps/agentic-os' });
      const info = JSON.parse(infoResult.stdout);
      if (info.ok && info.data?.sheets?.[0]) {
        targetSheet = info.data.sheets[0].sheet_id;
      } else {
        return 'Error: Could not determine sheet. Please provide sheetId.';
      }
    }

    const readRange = range || `${targetSheet}!A1:Z100`;
    const fullRange = readRange.includes('!') ? readRange : `${targetSheet}!${readRange}`;
    const cmd = `lark-cli ${profileFlag} sheets cells-get --spreadsheet-token ${spreadsheetToken} --range "${fullRange}" --as user --json`;
    const { stdout } = await execAsync(cmd, { cwd: '/home/ubuntu/apps/agentic-os', maxBuffer: 10 * 1024 * 1024 });
    const result = JSON.parse(stdout);
    if (result.ok) {
      const values = result.data?.valueRange?.values || [];
      if (values.length === 0) return 'No data found in range.';
      // Format as table
      return values.map((row: unknown[], i: number) => {
        const cells = row.map(v => v === null ? '' : String(v));
        return cells.join(' | ');
      }).slice(0, 100).join('\n');
    }
    return `Error reading sheet: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkSheetsWrite(spreadsheetToken: string, range: string, values: string[][], appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';

    // Build the --value JSON
    const valueJson = JSON.stringify(values);
    const cmd = `lark-cli ${profileFlag} sheets cells-set --spreadsheet-token ${spreadsheetToken} --range "${range}" --value '${valueJson}' --as user --json`;
    const { stdout } = await execAsync(cmd, { cwd: '/home/ubuntu/apps/agentic-os' });
    const result = JSON.parse(stdout);
    if (result.ok) {
      return `Written ${values.length} rows to ${range}. Updated cells: ${result.data?.updatedCells || 'unknown'}`;
    }
    return `Error writing to sheet: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkSheetsCreate(title: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';

    const cmd = `lark-cli ${profileFlag} sheets workbook-create --title "${title.replace(/"/g, '\\"')}" --as user --json`;
    const { stdout } = await execAsync(cmd, { cwd: '/home/ubuntu/apps/agentic-os' });
    const result = JSON.parse(stdout);
    if (result.ok) {
      const ss = result.data?.spreadsheet || {};
      return `Spreadsheet created: "${title}" (token: ${ss.spreadsheet_token}, url: ${ss.url || 'N/A'})`;
    }
    return `Error creating spreadsheet: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkSheetsInfo(spreadsheetToken: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';

    const cmd = `lark-cli ${profileFlag} sheets workbook-info --spreadsheet-token ${spreadsheetToken} --as user --json`;
    const { stdout } = await execAsync(cmd, { cwd: '/home/ubuntu/apps/agentic-os' });
    const result = JSON.parse(stdout);
    if (result.ok) {
      const sheets = result.data?.sheets || [];
      if (sheets.length === 0) return 'No sheets found in this spreadsheet.';
      return sheets.map((s: Record<string, unknown>, i: number) => `${i + 1}. ${s.title || 'Untitled'} (sheet_id: ${s.sheet_id}, rows: ${s.row_count}, cols: ${s.column_count})`).join('\n');
    }
    return `Error getting sheet info: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

// === Lark Tasks ===

async function larkTaskCreate(title: string, description?: string, dueDate?: string, assigneeIds?: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';

    let cmd = `lark-cli ${profileFlag} task +create --summary "${title.replace(/"/g, '\\"')}" --as user --json`;
    if (description) cmd += ` --description "${description.replace(/"/g, '\\"')}"`;
    if (dueDate) cmd += ` --due "${dueDate}"`;
    if (assigneeIds) cmd += ` --assignee "${assigneeIds.split(',')[0].trim()}"`;
    const { stdout } = await execAsync(cmd, { cwd: '/home/ubuntu/apps/agentic-os' });
    const result = JSON.parse(stdout);
    if (result.ok) {
      return `Task created: "${title}" (id: ${result.data?.task?.guid || 'unknown'})`;
    }
    return `Error creating task: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkTaskList(appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';

    const { stdout } = await execAsync(
      `lark-cli ${profileFlag} task +get-my-tasks --as user --json`,
      { cwd: '/home/ubuntu/apps/agentic-os' }
    );
    const result = JSON.parse(stdout);
    if (result.ok) {
      const items = result.data?.items || [];
      if (items.length === 0) return 'No tasks found.';
      return items.slice(0, 20).map((t: Record<string, unknown>, i: number) => {
        const status = (t.completed_at || (t as Record<string, unknown>).done_at) ? '✅' : '⬜';
        return `${i + 1}. ${status} ${t.title || 'Untitled'} (id: ${t.guid})`;
      }).join('\n');
    }
    return `Error listing tasks: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkTaskComplete(taskId: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';

    const { stdout } = await execAsync(
      `lark-cli ${profileFlag} task +complete --task-id ${taskId} --as user --json`,
      { cwd: '/home/ubuntu/apps/agentic-os' }
    );
    const result = JSON.parse(stdout);
    if (result.ok) return `Task ${taskId} marked complete.`;
    return `Error completing task: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkTaskSearch(query: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';

    const { stdout } = await execAsync(
      `lark-cli ${profileFlag} task +search --query "${query.replace(/"/g, '\\"')}" --as user --json`,
      { cwd: '/home/ubuntu/apps/agentic-os' }
    );
    const result = JSON.parse(stdout);
    if (result.ok) {
      const items = result.data?.items || [];
      if (items.length === 0) return `No tasks found matching "${query}".`;
      return items.slice(0, 15).map((t: Record<string, unknown>, i: number) => {
        const status = (t.completed_at || (t as Record<string, unknown>).done_at) ? '✅' : '⬜';
        return `${i + 1}. ${status} ${t.title || 'Untitled'} (id: ${t.guid})`;
      }).join('\n');
    }
    return `Error searching tasks: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

// === Lark Approvals ===

async function larkApprovalList(appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';

    const { stdout } = await execAsync(
      `lark-cli ${profileFlag} approval tasks query --topic 1 --as user --json`,
      { cwd: '/home/ubuntu/apps/agentic-os' }
    );
    const result = JSON.parse(stdout);
    if (result.code === 0 || result.ok) {
      const items = result.data?.items || [];
      if (items.length === 0) return 'No pending approvals found.';
      return items.slice(0, 20).map((inst: Record<string, unknown>, i: number) => {
        const title = inst.title || inst.approval_name || 'Untitled';
        const status = inst.status || 'PENDING';
        return `${i + 1}. ⏳ ${title} (id: ${inst.instance_id || inst.task_id}, status: ${status})`;
      }).join('\n');
    }
    return `Error listing approvals: ${result.msg || result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkApprovalApprove(instanceId: string, taskId: string, comment?: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';

    const body = JSON.stringify({ instance_code: instanceId, task_id: taskId, comment: comment || 'Approved' });
    const { stdout } = await execAsync(
      `lark-cli ${profileFlag} approval tasks approve --data '${body}' --as user --json --yes`,
      { cwd: '/home/ubuntu/apps/agentic-os' }
    );
    const result = JSON.parse(stdout);
    if (result.code === 0 || result.ok) return `Approval ${instanceId} approved.`;
    return `Error approving: ${result.msg || result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkApprovalReject(instanceId: string, taskId: string, comment?: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';

    const body = JSON.stringify({ instance_code: instanceId, task_id: taskId, comment: comment || 'Rejected' });
    const { stdout } = await execAsync(
      `lark-cli ${profileFlag} approval tasks reject --data '${body}' --as user --json --yes`,
      { cwd: '/home/ubuntu/apps/agentic-os' }
    );
    const result = JSON.parse(stdout);
    if (result.code === 0 || result.ok) return `Approval ${instanceId} rejected.`;
    return `Error rejecting: ${result.msg || result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}


// === Lark Drive ===

async function larkDriveSearch(query: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';
    const { stdout } = await execAsync(
      `lark-cli ${profileFlag} drive +search --query "${query.replace(/"/g, '\\"')}" --as user --json`,
      { cwd: '/home/ubuntu/apps/agentic-os' }
    );
    const result = JSON.parse(stdout);
    if (result.ok) {
      const items = result.data?.items || [];
      if (items.length === 0) return `No files found matching "${query}".`;
      return items.slice(0, 15).map((f: Record<string, unknown>, i: number) => {
        const type = f.type === 'doc' ? '📄' : f.type === 'sheet' ? '📊' : f.type === 'bitable' ? '🗃️' : f.type === 'folder' ? '📁' : '📎';
        return `${i + 1}. ${type} ${f.title || 'Untitled'} (token: ${f.docs_token || f.token}, type: ${f.type})`;
      }).join('\n');
    }
    return `Error searching drive: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkDriveUpload(filePathParam: string, folderToken?: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';
    let cmd = `lark-cli ${profileFlag} drive +upload "${filePathParam}" --as user --json`;
    if (folderToken) cmd += ` --folder-token "${folderToken}"`;
    const { stdout } = await execAsync(cmd, { cwd: '/home/ubuntu/apps/agentic-os' });
    const result = JSON.parse(stdout);
    if (result.ok) {
      const f = result.data?.file || {};
      return `File uploaded: ${f.name || filePathParam} (token: ${f.file_token || 'unknown'})`;
    }
    return `Error uploading: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkDriveDownload(fileToken: string, outputPath?: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';
    const output = outputPath || '/tmp/lark_download';
    const { stdout } = await execAsync(
      `lark-cli ${profileFlag} drive +download --file-token ${fileToken} --output "${output}" --as user --json`,
      { cwd: '/home/ubuntu/apps/agentic-os' }
    );
    const result = JSON.parse(stdout);
    if (result.ok) return `File downloaded to: ${output}`;
    return `Error downloading: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkDriveCreateFolder(name: string, folderToken?: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';
    let cmd = `lark-cli ${profileFlag} drive +create-folder --name "${name.replace(/"/g, '\\"')}" --as user --json`;
    if (folderToken) cmd += ` --folder-token "${folderToken}"`;
    const { stdout } = await execAsync(cmd, { cwd: '/home/ubuntu/apps/agentic-os' });
    const result = JSON.parse(stdout);
    if (result.ok) return `Folder created: "${name}" (token: ${result.data?.token || 'unknown'})`;
    return `Error creating folder: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

// === Lark VC (Video Conference) ===

async function larkVcSearch(query: string, startTime?: string, endTime?: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';
    let cmd = `lark-cli ${profileFlag} vc +search --as user --json`;
    if (query) cmd += ` --query "${query.replace(/"/g, '\\"')}"`;
    if (startTime) cmd += ` --start-time "${startTime}"`;
    if (endTime) cmd += ` --end-time "${endTime}"`;
    const { stdout } = await execAsync(cmd, { cwd: '/home/ubuntu/apps/agentic-os' });
    const result = JSON.parse(stdout);
    if (result.ok) {
      const items = result.data?.room_meeting_list || [];
      if (items.length === 0) return 'No meetings found.';
      return items.slice(0, 10).map((m: Record<string, unknown>, i: number) =>
        `${i + 1}. ${m.topic || 'Untitled'} (id: ${m.meeting_id}, time: ${m.start_time || 'N/A'}, status: ${m.status || 'N/A'})`
      ).join('\n');
    }
    return `Error searching meetings: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkVcListActive(appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';
    const { stdout } = await execAsync(
      `lark-cli ${profileFlag} vc +meeting-list-active --as user --json`,
      { cwd: '/home/ubuntu/apps/agentic-os' }
    );
    const result = JSON.parse(stdout);
    if (result.ok) {
      const items = result.data?.meetings || [];
      if (items.length === 0) return 'No active meetings.';
      return items.map((m: Record<string, unknown>, i: number) =>
        `${i + 1}. ${m.topic || 'Untitled'} (id: ${m.meeting_id})`
      ).join('\n');
    }
    return `Error listing active meetings: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkVcNotes(meetingId: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';
    const { stdout } = await execAsync(
      `lark-cli ${profileFlag} vc +notes --meeting-ids "${meetingId}" --as user --json`,
      { cwd: '/home/ubuntu/apps/agentic-os', maxBuffer: 10 * 1024 * 1024 }
    );
    const result = JSON.parse(stdout);
    if (result.ok) {
      const notes = result.data?.meeting_notes_list || [];
      if (notes.length === 0) return 'No notes found for this meeting.';
      return notes.map((n: Record<string, unknown>) => {
        const content = (n.notes_content || '').toString().slice(0, 5000);
        return `Notes for meeting ${meetingId}:\n${content}`;
      }).join('\n---\n');
    }
    return `Error getting meeting notes: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

// === Lark Message Search ===

async function larkMessageSearch(query: string, chatId?: string, startTime?: string, endTime?: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';
    let cmd = `lark-cli ${profileFlag} im +messages-search --query "${query.replace(/"/g, '\\"')}" --as user --json`;
    if (chatId) cmd += ` --chat-id ${chatId}`;
    if (startTime) cmd += ` --start-time "${startTime}"`;
    if (endTime) cmd += ` --end-time "${endTime}"`;
    const { stdout } = await execAsync(cmd, { cwd: '/home/ubuntu/apps/agentic-os' });
    const result = JSON.parse(stdout);
    if (result.ok) {
      const items = result.data?.items || [];
      if (items.length === 0) return `No messages found matching "${query}".`;
      return items.slice(0, 15).map((m: Record<string, unknown>, i: number) => {
        const body = String(m.body || m.content || '').slice(0, 100);
        return `${i + 1}. [${m.sender_id || 'unknown'}] ${body} (msg_id: ${m.message_id}, chat: ${m.chat_id || 'N/A'})`;
      }).join('\n');
    }
    return `Error searching messages: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkMessageSendTool(chatId: string, content: string, msgType?: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';
    const type = msgType || 'text';
    const { stdout } = await execAsync(
      `lark-cli ${profileFlag} im +messages-send --chat-id ${chatId} --msg-type "${type}" --content '${content}' --as user --json`,
      { cwd: '/home/ubuntu/apps/agentic-os' }
    );
    const result = JSON.parse(stdout);
    if (result.ok) return `Message sent to chat ${chatId} (msg_id: ${result.data?.message_id || 'unknown'})`;
    return `Error sending message: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

// === Lark Group Management ===

async function larkGroupList(appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';
    const { stdout } = await execAsync(
      `lark-cli ${profileFlag} im +chat-list --as user --json`,
      { cwd: '/home/ubuntu/apps/agentic-os' }
    );
    const result = JSON.parse(stdout);
    if (result.ok) {
      const items = result.data?.items || [];
      if (items.length === 0) return 'No groups found.';
      return items.slice(0, 20).map((g: Record<string, unknown>, i: number) =>
        `${i + 1}. ${g.name || 'Unnamed'} (chat_id: ${g.chat_id}, members: ${g.user_count || '?'}, mode: ${g.chat_mode || 'group'})`
      ).join('\n');
    }
    return `Error listing groups: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkGroupCreate(name: string, description?: string, memberIds?: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';
    let cmd = `lark-cli ${profileFlag} im +chat-create --name "${name.replace(/"/g, '\\"')}" --as user --json`;
    if (description) cmd += ` --description "${description.replace(/"/g, '\\"')}"`;
    if (memberIds) {
      const ids = memberIds.split(',').map(id => id.trim()).filter(Boolean);
      for (const id of ids) cmd += ` --member-id ${id}`;
    }
    const { stdout } = await execAsync(cmd, { cwd: '/home/ubuntu/apps/agentic-os' });
    const result = JSON.parse(stdout);
    if (result.ok) return `Group "${name}" created (chat_id: ${result.data?.chat_id || 'unknown'})`;
    return `Error creating group: ${result.error || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function larkGroupMembers(chatId: string, appId?: string): Promise<string> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const profile = appId ? await getLarkProfile(appId) : '';
    const profileFlag = profile ? `--profile ${profile}` : '';
    const { stdout } = await execAsync(
      `lark-cli ${profileFlag} chat.members list --as user --data '{"chat_id":"${chatId}"}' --json`,
      { cwd: '/home/ubuntu/apps/agentic-os' }
    );
    const result = JSON.parse(stdout);
    if (result.ok || result.code === 0) {
      const items = result.data?.items || [];
      if (items.length === 0) return 'No members found.';
      return items.slice(0, 30).map((m: Record<string, unknown>, i: number) =>
        `${i + 1}. ${m.name || m.member_id || 'Unknown'} (id: ${m.member_id}, type: ${m.member_id_type || 'user'})`
      ).join('\n');
    }
    return `Error listing members: ${result.error || result.msg || 'unknown'}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function ms365EmailSend(to: string, subject: string, body: string): Promise<string> {
  try {
    const { ms365SendEmail } = await import('@/lib/microsoft365');
    await ms365SendEmail('', to, subject, body);
    return `Email sent to ${to}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function ms365CalendarList(): Promise<string> {
  try {
    const { ms365ListCalendars } = await import('@/lib/microsoft365');
    const data = await ms365ListCalendars('') as { value?: { name: string; id: string }[] };
    const items = data.value || [];
    if (items.length === 0) return 'No calendars found.';
    return items.map(c => `📅 ${c.name} (${c.id})`).join('\n');
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

async function ms365CalendarCreate(subject: string, start: string, end: string, attendees?: string[]): Promise<string> {
  try {
    const { ms365CreateEvent } = await import('@/lib/microsoft365');
    const data = await ms365CreateEvent('', subject, start, end, undefined, attendees) as { id: string };
    return `Event created: ${data.id}`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : 'unknown'}`; }
}

// === Workflow Template & Plugin Tools ===

async function workflowTemplateList(limit?: number): Promise<string> {
  const rows = await getMany<{ id: string; name: string; description: string | null; category: string; use_count: number; public: boolean }>(
    'SELECT id, name, description, category, use_count, public FROM workflow_templates WHERE public = true ORDER BY use_count DESC LIMIT $1',
    [limit || 10]
  );
  if (rows.length === 0) return 'No public workflow templates.';
  return rows.map(r => `📋 ${r.name} [${r.category}] (used ${r.use_count}x)${r.description ? ': ' + r.description : ''}`).join('\n');
}

async function pluginList(limit?: number): Promise<string> {
  const rows = await getMany<{ id: string; name: string; plugin_type: string; version: string; enabled: boolean }>(
    'SELECT id, name, plugin_type, version, enabled FROM plugins ORDER BY created_at DESC LIMIT $1',
    [limit || 10]
  );
  if (rows.length === 0) return 'No plugins installed.';
  return rows.map(r => `🔌 ${r.name} v${r.version} [${r.plugin_type}] ${r.enabled ? '✅' : '⏸️'}`).join('\n');
}

async function pluginInfo(pluginId: string): Promise<string> {
  const plugin = await getOne<{ id: string; name: string; description: string | null; version: string; plugin_type: string; manifest: unknown; enabled: boolean }>(
    'SELECT * FROM plugins WHERE id = $1', [pluginId]
  );
  if (!plugin) return `Plugin not found: ${pluginId}`;
  return `Plugin: ${plugin.name} v${plugin.version}\nType: ${plugin.plugin_type}\nEnabled: ${plugin.enabled}\nDescription: ${plugin.description || 'none'}\nManifest: ${JSON.stringify(plugin.manifest)}`;
}

// PDF Generation Tool — uses jsPDF (pure JS, no external font files needed)
async function generatePdf(title: string, content: string, chatId?: string, appId?: string): Promise<string> {
  try {
    const { jsPDF } = await import('jspdf');
    const tmpDir = path.join(process.cwd(), '.tmp-pdfs');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const safeName = title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
    const filePath = path.join(tmpDir, `${safeName}_${Date.now()}.pdf`);
    const relPath = path.relative(process.cwd(), filePath);

    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const M = 20;
    const maxW = pageW - M * 2;
    let y = M;
    const BOTTOM = 275;

    function pageCheck(need: number) {
      if (y + need > BOTTOM) { doc.addPage(); y = M; }
    }

    // Strip **bold** and *italic* markers, keep text content
    function stripMd(t: string): string {
      return t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
    }

    // Render one logical line: strip markdown, use splitTextToSize, print
    function renderLine(text: string, fontSize: number, bold = false, indent = 0) {
      const plain = stripMd(text);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(fontSize);
      const wrapped: string[] = doc.splitTextToSize(plain, maxW - indent);
      const lh = fontSize * 0.5; // line height in mm
      for (const wl of wrapped) {
        pageCheck(lh);
        doc.text(wl, M + indent, y);
        y += lh;
      }
    }

    // Title (centered)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    const tWrapped: string[] = doc.splitTextToSize(stripMd(title), maxW);
    for (const tl of tWrapped) {
      pageCheck(10);
      doc.text(tl, pageW / 2, y, { align: 'center' });
      y += 9;
    }
    y += 3;
    doc.setDrawColor(200);
    doc.line(M, y, pageW - M, y);
    y += 6;

    // Content
    const lines = content.split('\n');
    for (const line of lines) {
      pageCheck(12);
      if (line.startsWith('# ')) {
        renderLine(line.replace(/^# /, ''), 15, true);
        y += 4;
      } else if (line.startsWith('## ')) {
        renderLine(line.replace(/^## /, ''), 13, true);
        y += 3;
      } else if (line.startsWith('### ')) {
        renderLine(line.replace(/^### /, ''), 11, true);
        y += 2;
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        renderLine('• ' + line.replace(/^[-*] /, ''), 10, false, 4);
        y += 1.5;
      } else if (/^\d+\. /.test(line)) {
        renderLine(line, 10, false, 4);
        y += 1.5;
      } else if (line.trim() === '') {
        y += 4;
      } else {
        renderLine(line, 10);
        y += 1.5;
      }
    }

    // Footer
    y += 10;
    pageCheck(8);
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(`Generated by Agentic OS — ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`, pageW / 2, y, { align: 'center' });

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
    fs.writeFileSync(filePath, pdfBuffer);

    // If chatId provided, auto-send the file
    if (chatId && appId) {
      await sendPdfToLark(relPath, chatId, appId);
      return `PDF generated and sent: ${title}`;
    }
    return `PDF generated: ${title} (path: ${relPath})`;
  } catch (e) {
    return `Error generating PDF: ${String(e)}`;
  }
}

async function sendPdfToLark(filePath: string, chatId: string, appId: string): Promise<void> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  const profile = await getLarkProfile(appId);
  const profileFlag = profile ? `--profile ${profile}` : '';
  const cmd = `lark-cli ${profileFlag} im +messages-send --file "${filePath}" --chat-id "${chatId}" --as bot`;
  const { stdout } = await execAsync(cmd, { cwd: '/home/ubuntu/apps/agentic-os', timeout: 30000 });
  const result = JSON.parse(stdout);
  if (result.ok === false) throw new Error(result.error || 'Failed to send file');
}

// Google Drive read tool — supports Docs, Sheets, PDFs, and folder listing from shared URLs
async function googleDriveRead(url: string, maxChars = 15000): Promise<string> {
  try {
    // Extract file/folder ID from various Google Drive URL formats
    let fileId = '';
    let isFolder = false;

    // Folder: /drive/folders/ID
    const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch) {
      fileId = folderMatch[1];
      isFolder = true;
    }

    // File: /document/d/ID or /spreadsheets/d/ID or /file/d/ID
    if (!fileId) {
      const fileMatch = url.match(/\/(document|spreadsheets|file|presentation)\/d\/([a-zA-Z0-9_-]+)/);
      if (fileMatch) fileId = fileMatch[2];
    }

    // Generic: /d/ID
    if (!fileId) {
      const genericMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (genericMatch) fileId = genericMatch[1];
    }

    if (!fileId) return 'Error: Could not extract Google Drive file ID from URL';

    const https = await import('https');
    const http = await import('http');

    function fetchUrl(targetUrl: string): Promise<{ status: number; body: string }> {
      return new Promise((resolve, reject) => {
        const mod = targetUrl.startsWith('https') ? https : http;
        mod.get(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
          // Follow redirects
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return fetchUrl(res.headers.location).then(resolve).catch(reject);
          }
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
        }).on('error', reject);
      });
    }

    if (isFolder) {
      // List folder contents via the folder page HTML
      const folderUrl = `https://drive.google.com/drive/folders/${fileId}`;
      const { body } = await fetchUrl(folderUrl);
      // Extract file names and IDs from the HTML
      const files: { name: string; id: string; type: string }[] = [];
      // Google Drive renders file data in JS, extract from data attributes
      const nameMatches = body.matchAll(/"([^"]+\.(?:docx|xlsx|pdf|doc|xls|txt|csv|pptx|jpg|png|jpeg))"/gi);
      for (const m of nameMatches) {
        files.push({ name: m[1], id: '', type: 'file' });
      }
      // Also try to extract from title/meta
      const titleMatch = body.match(/<title>([^<]+)<\/title>/);
      const folderName = titleMatch ? titleMatch[1].replace(' - Google Drive', '').trim() : 'Folder';

      if (files.length === 0) {
        return `Folder: ${folderName}\nURL: ${folderUrl}\n\n(Could not extract file list from folder page. Please share individual file links instead.)`;
      }

      return `Folder: ${folderName}\nFiles found: ${files.length}\n${files.map((f, i) => `${i + 1}. ${f.name}`).join('\n')}`;
    }

    // Determine file type from URL
    const isDoc = url.includes('/document/') || url.includes('/d/');
    const isSheet = url.includes('/spreadsheets/');
    const isPresentation = url.includes('/presentation/');

    let exportUrl = '';
    if (isSheet) {
      exportUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv`;
    } else if (isPresentation) {
      exportUrl = `https://docs.google.com/presentation/d/${fileId}/export?format=txt`;
    } else {
      // Default: Google Docs → export as plain text
      exportUrl = `https://docs.google.com/document/d/${fileId}/export?format=txt`;
    }

    const { status, body } = await fetchUrl(exportUrl);
    if (status !== 200) {
      // Try alternative: direct document view
      const viewUrl = `https://docs.google.com/document/d/${fileId}/pub`;
      const viewResult = await fetchUrl(viewUrl);
      if (viewResult.status === 200) {
        const text = viewResult.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return `Content (from ${fileId}):\n\n${text.slice(0, maxChars)}`;
      }
      return `Error: Could not access file (HTTP ${status}). Make sure the file is shared as 'Anyone with the link'.`;
    }

    let content = body;
    // For CSV, format nicely
    if (isSheet) {
      const rows = content.split('\n').filter((r: string) => r.trim());
      const maxRows = 50;
      const display = rows.slice(0, maxRows);
      content = display.join('\n');
      if (rows.length > maxRows) content += `\n\n... (${rows.length - maxRows} more rows)`;
    }

    if (content.length > maxChars) {
      content = content.slice(0, maxChars) + `\n\n... (truncated, ${content.length} total chars)`;
    }

    return `Content from Google ${isSheet ? 'Sheet' : isPresentation ? 'Slides' : 'Doc'} (${fileId}):\n\n${content}`;
  } catch (e) {
    return `Error reading Google Drive: ${String(e)}`;
  }
}

// Parse tool calls from LLM response
export function parseToolCalls(content: string): { name: string; args: Record<string, unknown> }[] {
  const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
  const regex = /\{"tool_call":\s*\{"name":\s*"([^"]+)",\s*"args":\s*(\{[^}]+\})\}\}/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    try {
      toolCalls.push({ name: match[1], args: JSON.parse(match[2]) });
    } catch { /* skip malformed */ }
  }
  return toolCalls;
}

// GOR-139: GitHub tool helpers — uses OAuth connection
async function getGitHubToken(userId?: string): Promise<string> {
  if (!userId) throw new Error('User ID required for GitHub operations');
  const { getConnection } = await import('./oauth');
  const conn = await getConnection(userId, 'github');
  if (!conn) throw new Error('GitHub not connected. Go to Integrations → Connect GitHub.');
  return conn.access_token;
}

async function githubListRepos(userId?: string, perPage?: number) {
  const token = await getGitHubToken(userId);
  const { listRepos } = await import('./github');
  const { data, error } = await listRepos(token, perPage || 20);
  if (error) throw new Error(error);
  return (data as Array<{ full_name: string; description: string; stargazers_count: number; language: string; html_url: string }>)
    .map(r => `${r.full_name} ⭐${r.stargazers_count} [${r.language || 'n/a'}] — ${r.description || 'No description'}\n${r.html_url}`)
    .join('\n\n');
}

async function githubListIssues(userId?: string, owner?: string, repo?: string, state?: string) {
  const token = await getGitHubToken(userId);
  const { listIssues } = await import('./github');
  const { data, error } = await listIssues(token, owner!, repo!, state || 'open');
  if (error) throw new Error(error);
  return (data as Array<{ number: number; title: string; state: string; user: { login: string }; html_url: string }>)
    .map(i => `#${i.number} [${i.state}] ${i.title} — by ${i.user.login}\n${i.html_url}`)
    .join('\n') || 'No issues found.';
}

async function githubCreateIssue(userId?: string, owner?: string, repo?: string, title?: string, body?: string, labels?: string[]) {
  const token = await getGitHubToken(userId);
  const { createIssue } = await import('./github');
  const { data, error } = await createIssue(token, owner!, repo!, title!, body, labels);
  if (error) throw new Error(error);
  const issue = data as { number: number; html_url: string };
  return `Issue #${issue.number} created: ${issue.html_url}`;
}

async function githubListPRs(userId?: string, owner?: string, repo?: string, state?: string) {
  const token = await getGitHubToken(userId);
  const { listPullRequests } = await import('./github');
  const { data, error } = await listPullRequests(token, owner!, repo!, state || 'open');
  if (error) throw new Error(error);
  return (data as Array<{ number: number; title: string; state: string; user: { login: string }; html_url: string }>)
    .map(pr => `PR #${pr.number} [${pr.state}] ${pr.title} — by ${pr.user.login}\n${pr.html_url}`)
    .join('\n') || 'No pull requests found.';
}

async function githubListWorkflows(userId?: string, owner?: string, repo?: string) {
  const token = await getGitHubToken(userId);
  const { listWorkflows } = await import('./github');
  const { data, error } = await listWorkflows(token, owner!, repo!);
  if (error) throw new Error(error);
  const workflows = (data as { workflows: Array<{ id: number; name: string; state: string; html_url: string }> }).workflows;
  return workflows?.map(w => `${w.name} [${w.state}] — ${w.html_url}`).join('\n') || 'No workflows found.';
}

async function githubGetFile(userId?: string, owner?: string, repo?: string, path?: string, ref?: string) {
  const token = await getGitHubToken(userId);
  const { getFile } = await import('./github');
  const { data, error } = await getFile(token, owner!, repo!, path!, ref);
  if (error) throw new Error(error);
  const file = data as { content: string; encoding: string; sha: string; size: number };
  const content = file.encoding === 'base64' ? Buffer.from(file.content, 'base64').toString('utf-8') : file.content;
  return `File: ${path} (${file.size} bytes, sha: ${file.sha.slice(0, 8)})\n\n${content.slice(0, 30000)}`;
}

async function githubCreateFile(userId?: string, owner?: string, repo?: string, path?: string, content?: string, message?: string, branch?: string) {
  const token = await getGitHubToken(userId);
  // Check if file exists (need sha for update)
  const { getFile, createOrUpdateFile } = await import('./github');
  const existing = await getFile(token, owner!, repo!, path!, branch);
  const sha = existing.data ? (existing.data as { sha: string }).sha : undefined;
  const { data, error } = await createOrUpdateFile(token, owner!, repo!, path!, content!, message!, sha, branch);
  if (error) throw new Error(error);
  const result = data as { content: { html_url: string } };
  return `File ${sha ? 'updated' : 'created'}: ${result.content.html_url}`;
}

// GOR-140: Notion tool helpers
async function getNotionToken(userId?: string): Promise<string> {
  if (!userId) throw new Error('User ID required for Notion operations');
  const { getConnection } = await import('./oauth');
  const conn = await getConnection(userId, 'notion');
  if (!conn) throw new Error('Notion not connected. Go to Integrations → Connect Notion.');
  return conn.access_token;
}

async function notionSearch(userId?: string, query?: string) {
  const token = await getNotionToken(userId);
  const { searchPages } = await import('./notion');
  const { data, error } = await searchPages(token, query);
  if (error) throw new Error(error);
  return (data.results || []).map((p: { id: string; properties: Record<string, unknown> }) => {
    const titleProp = Object.values(p.properties).find((v: unknown) => (v as { title?: unknown[] }).title) as { title?: Array<{ plain_text: string }> } | undefined;
    const title = titleProp?.title?.map((t) => t.plain_text).join('') || 'Untitled';
    return `${title} (${p.id})`;
  }).join('\n') || 'No pages found.';
}

async function notionGetPage(userId: string | undefined, pageId: string) {
  const token = await getNotionToken(userId);
  const { getPage, getBlockChildren } = await import('./notion');
  const { data: page, error } = await getPage(token, pageId);
  if (error) throw new Error(error);
  const titleProp = Object.values(page.properties).find((v: unknown) => (v as { title?: unknown[] }).title) as { title?: Array<{ plain_text: string }> } | undefined;
  const title = titleProp?.title?.map((t) => t.plain_text).join('') || 'Untitled';
  const blocks = await getBlockChildren(token, pageId);
  const content = (blocks.data?.results || []).map((b: { type: string; [key: string]: unknown }) => {
    const block = b[b.type] as { rich_text?: Array<{ plain_text: string }> } | undefined;
    return block?.rich_text?.map((t) => t.plain_text).join('') || '';
  }).filter(Boolean).join('\n');
  return `# ${title}\n\n${content.slice(0, 20000)}`;
}

async function notionCreatePage(userId?: string, databaseId?: string, properties?: Record<string, unknown>) {
  const token = await getNotionToken(userId);
  const { createPage } = await import('./notion');
  const { data, error } = await createPage(token, databaseId!, properties!);
  if (error) throw new Error(error);
  return `Page created: ${data.url}`;
}

async function notionListDatabases(userId?: string) {
  const token = await getNotionToken(userId);
  const { listDatabases } = await import('./notion');
  const { data, error } = await listDatabases(token);
  if (error) throw new Error(error);
  return (data.results || []).map((d: { id: string; title: Array<{ plain_text: string }> }) =>
    `${d.title.map((t) => t.plain_text).join('')} (${d.id})`
  ).join('\n') || 'No databases found.';
}

async function notionQueryDatabase(userId?: string, databaseId?: string, filter?: unknown) {
  const token = await getNotionToken(userId);
  const { queryDatabase } = await import('./notion');
  const { data, error } = await queryDatabase(token, databaseId!, filter as Record<string, unknown>);
  if (error) throw new Error(error);
  return `${data.results.length} records found.\n${JSON.stringify(data.results.slice(0, 5), null, 2).slice(0, 10000)}`;
}

// GOR-140: Slack tool helpers
async function getSlackToken(userId?: string): Promise<string> {
  if (!userId) throw new Error('User ID required for Slack operations');
  const { getConnection } = await import('./oauth');
  const conn = await getConnection(userId, 'slack');
  if (!conn) throw new Error('Slack not connected. Go to Integrations → Connect Slack.');
  return conn.access_token;
}

async function slackListChannels(userId?: string) {
  const token = await getSlackToken(userId);
  const { listChannels } = await import('./slack');
  const { data, error } = await listChannels(token);
  if (error) throw new Error(error);
  return (data.channels || []).map((c: { name: string; id: string; is_member: boolean }) =>
    `#${c.name} (${c.id})${c.is_member ? ' ✓' : ''}`
  ).join('\n') || 'No channels found.';
}

async function slackSendMessageTool(userId?: string, channel?: string, text?: string) {
  const token = await getSlackToken(userId);
  const { sendMessage } = await import('./slack');
  const { data, error } = await sendMessage(token, channel!, text!);
  if (error) throw new Error(error);
  return `Message sent to ${channel}`;
}

async function slackSearchMessages(userId?: string, query?: string) {
  const token = await getSlackToken(userId);
  const { searchMessages } = await import('./slack');
  const { data, error } = await searchMessages(token, query!);
  if (error) throw new Error(error);
  return `${data.messages?.matches?.length || 0} results found.\n${JSON.stringify(data.messages?.matches?.slice(0, 5), null, 2).slice(0, 10000)}`;
}

// GOR-140: Airtable tool helpers
async function getAirtableToken(userId?: string): Promise<string> {
  if (!userId) throw new Error('User ID required for Airtable operations');
  const { getConnection } = await import('./oauth');
  const conn = await getConnection(userId, 'airtable');
  if (!conn) throw new Error('Airtable not connected. Go to Integrations → Connect Airtable.');
  return conn.access_token;
}

async function airtableListBases(userId?: string) {
  const token = await getAirtableToken(userId);
  const { listBases } = await import('./airtable');
  const { data, error } = await listBases(token);
  if (error) throw new Error(error);
  return (data.bases || []).map((b: { name: string; id: string }) => `${b.name} (${b.id})`).join('\n') || 'No bases found.';
}

async function airtableListRecords(userId?: string, baseId?: string, tableId?: string, maxRecords?: number) {
  const token = await getAirtableToken(userId);
  const { listRecords } = await import('./airtable');
  const { data, error } = await listRecords(token, baseId!, tableId!, { maxRecords: maxRecords || 20 });
  if (error) throw new Error(error);
  return `${data.records?.length || 0} records.\n${JSON.stringify(data.records?.slice(0, 5), null, 2).slice(0, 10000)}`;
}

async function airtableCreateRecordTool(userId?: string, baseId?: string, tableId?: string, fields?: Record<string, unknown>) {
  const token = await getAirtableToken(userId);
  const { createRecord } = await import('./airtable');
  const { data, error } = await createRecord(token, baseId!, tableId!, fields!);
  if (error) throw new Error(error);
  return `Record created: ${data.id}`;
}

// GOR-142: Integration availability checker
export function checkIntegrationForTool(toolName: string): { available: boolean; integration?: string; feature?: string; steps?: string[] } {
  const mapping: Record<string, { integration: string; feature: string; steps: string[] }> = {
    'lark_calendar_events': { integration: 'Lark', feature: 'check your calendar', steps: ['Connect Lark app in Settings', 'Grant calendar permission'] },
    'lark_task_list': { integration: 'Lark', feature: 'manage tasks', steps: ['Connect Lark app in Settings', 'Grant task permission'] },
    'lark_approval_list': { integration: 'Lark', feature: 'check approvals', steps: ['Connect Lark app in Settings', 'Grant approval permission'] },
    'lark_bitable_list': { integration: 'Lark', feature: 'access Bitable data', steps: ['Connect Lark app in Settings', 'Grant bitable permission'] },
    'github_create_issue': { integration: 'GitHub', feature: 'create issues', steps: ['Go to Integrations page', 'Connect GitHub with OAuth'] },
    'notion_create_page': { integration: 'Notion', feature: 'create Notion pages', steps: ['Go to Integrations page', 'Connect Notion with OAuth'] },
  };
  const config = mapping[toolName];
  if (!config) return { available: true };
  return { available: false, ...config };
}
