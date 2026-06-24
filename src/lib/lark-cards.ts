/**
 * Lark Interactive Cards — Foundation module (GOR-134)
 *
 * Provides typed builders for Lark Card JSON 1.0 (msg_type=interactive).
 * All builders return a plain object that can be JSON.stringify'd and
 * passed directly to sendLarkMessage(..., 'interactive', JSON.stringify(card)).
 *
 * Card JSON structure reference:
 *   { config, header, elements, card_link?, i18n_elements?, fallback? }
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type CardColor = 'blue' | 'wathet' | 'turquoise' | 'green' | 'yellow' | 'orange' | 'red' | 'carmine' | 'violet' | 'purple' | 'indigo' | 'grey' | 'default';
export type TextSize = 'x-small' | 'small' | 'medium' | 'large' | 'x-large' | 'heading-1' | 'heading-2' | 'heading-3' | 'heading-4' | 'not-set';
export type TextAlign = 'left' | 'center' | 'right';
export type ButtonSize = 'tiny' | 'small' | 'medium' | 'large';

export interface CardHeader {
  title: { tag: 'plain_text' | 'lark_md'; content: string };
  subtitle?: { tag: 'plain_text'; content: string };
  template?: CardColor;
  ud_icon?: { tag: 'custom_icon'; img_key: string };
  text_tag_list?: Array<{ tag_name: string; tag_color: string }>;
}

export interface CardElement {
  tag: string;
  [key: string]: unknown;
}

export interface CardAction {
  tag: 'action';
  actions: CardElement[];
  layout?: 'bisect' | 'trisection' | 'flow' | 'none';
  [key: string]: unknown;
}

export interface LarkCard {
  config?: {
    enable_forward?: boolean;
    update_multi?: boolean;
    width_mode?: 'compact' | 'fill' | 'default';
  };
  header?: CardHeader;
  elements: CardElement[];
  card_link?: { url: string };
  i18n_elements?: Record<string, CardElement[]>;
}

// ─── Element Builders ────────────────────────────────────────────────────────

/** Markdown text block (supports lark_md subset) */
export function md(content: string, options?: { text_align?: TextAlign; text_size?: TextSize }): CardElement {
  return {
    tag: 'div',
    text: {
      tag: 'lark_md',
      content,
      ...(options?.text_align && { text_align: options.text_align }),
      ...(options?.text_size && { text_size: options.text_size }),
    },
  };
}

/** Plain text block */
export function plainText(content: string, options?: { text_align?: TextAlign; text_size?: TextSize }): CardElement {
  return {
    tag: 'div',
    text: {
      tag: 'plain_text',
      content,
      ...(options?.text_align && { text_align: options.text_align }),
      ...(options?.text_size && { text_size: options.text_size }),
    },
  };
}

/** Horizontal divider */
export function divider(): CardElement {
  return { tag: 'hr' };
}

/** Column set (side-by-side layout) */
export function columnSet(columns: CardElement[], flex?: number[]): CardElement {
  return {
    tag: 'column_set',
    flex_mode: 'stretch',
    background_style: 'default',
    columns: columns.map((col, i) => ({
      tag: 'column',
      width: 'weighted',
      weight: flex?.[i] ?? 1,
      vertical_align: 'top',
      elements: Array.isArray(col) ? col : [col],
    })),
  };
}

/** Single column for use in columnSet */
export function column(elements: CardElement[], weight = 1): CardElement {
  return {
    tag: 'column',
    width: 'weighted',
    weight,
    vertical_align: 'top',
    elements,
  };
}

/** Note block (small grey text at bottom) */
export function note(content: string): CardElement {
  return {
    tag: 'note',
    elements: [{ tag: 'lark_md', content }],
  };
}

/** Image element */
export function image(imgKey: string, alt?: string, options?: { compact_width?: boolean; mode?: 'crop_center' | 'fit_horizontal' }): CardElement {
  return {
    tag: 'img',
    img_key: imgKey,
    alt: { tag: 'plain_text', content: alt || '' },
    ...(options?.compact_width && { compact_width: true }),
    ...(options?.mode && { mode: options.mode }),
  };
}

/** Interactive button */
export function button(
  text: string,
  value: Record<string, unknown>,
  options?: {
    type?: 'primary' | 'danger' | 'default' | 'text';
    size?: ButtonSize;
    icon?: { tag: 'standard_icon'; token: string };
    url?: string;
    confirm?: { title: string; text: string };
  }
): CardElement {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: text },
    type: options?.type || 'default',
    value,
    ...(options?.size && { size: options.size }),
    ...(options?.icon && { icon: options.icon }),
    ...(options?.url && { url: options.url }),
    ...(options?.confirm && {
      confirm: {
        title: { tag: 'plain_text', content: options.confirm.title },
        text: { tag: 'plain_text', content: options.confirm.text },
      },
    }),
  };
}

/** Multi-select menu */
export function selectMenu(
  placeholder: string,
  options: Array<{ text: string; value: string }>,
  value?: Record<string, unknown>
): CardElement {
  return {
    tag: 'select_menu',
    placeholder: { tag: 'plain_text', content: placeholder },
    options: options.map(o => ({
      text: { tag: 'plain_text', content: o.text },
      value: o.value,
    })),
    ...(value && { value }),
  };
}

/** Date picker */
export function datePicker(placeholder?: string, value?: string): CardElement {
  return {
    tag: 'date_picker',
    placeholder: { tag: 'plain_text', content: placeholder || 'Select date' },
    ...(value && { value }),
  };
}

/** Overflow menu (three dots) */
export function overflow(
  options: Array<{ text: string; value: string }>,
  value?: Record<string, unknown>
): CardElement {
  return {
    tag: 'overflow',
    options: options.map(o => ({
      text: { tag: 'plain_text', content: o.text },
      value: o.value,
    })),
    ...(value && { value }),
  };
}

// ─── Card Header Builders ────────────────────────────────────────────────────

export function header(title: string, options?: { subtitle?: string; color?: CardColor; icon?: string }): CardHeader {
  return {
    title: { tag: 'plain_text', content: title },
    ...(options?.subtitle && { subtitle: { tag: 'plain_text', content: options.subtitle } }),
    template: options?.color || 'blue',
    ...(options?.icon && { ud_icon: { tag: 'custom_icon', img_key: options.icon } }),
  };
}

// ─── Action Layout Builder ───────────────────────────────────────────────────

export function actionBlock(actions: CardElement[], layout?: CardAction['layout']): CardAction {
  return {
    tag: 'action',
    actions,
    ...(layout && { layout }),
  };
}

// ─── High-Level Card Builders ────────────────────────────────────────────────

/** Build a complete card from parts */
export function buildCard(
  elements: CardElement[],
  options?: {
    header?: CardHeader;
    config?: LarkCard['config'];
    cardLink?: string;
  }
): LarkCard {
  const card: LarkCard = { elements };
  if (options?.header) card.header = options.header;
  if (options?.config) card.config = options.config;
  if (options?.cardLink) card.card_link = { url: options.cardLink };
  return card;
}

/**
 * Default reply card — wraps plain text reply into a nicely formatted card.
 * Use this instead of raw text for all Lark bot replies.
 */
export function defaultCard(text: string, options?: { title?: string; color?: CardColor; footer?: string }): LarkCard {
  const elements: CardElement[] = [md(text)];
  if (options?.footer) {
    elements.push(divider());
    elements.push(note(options.footer));
  }
  return buildCard(elements, {
    header: header(options?.title || '🤖 Agentic OS', { color: options?.color || 'blue' }),
    config: { width_mode: 'default' },
  });
}

/**
 * Error card — for when something goes wrong.
 * Red header, error details, retry hint.
 */
export function errorCard(message: string, details?: string): LarkCard {
  const elements: CardElement[] = [
    md(`⚠️ ${message}`),
  ];
  if (details) {
    elements.push(md(`\`\`\`\n${details.slice(0, 500)}\n\`\`\``));
  }
  elements.push(divider());
  elements.push(note('Please try again or contact admin if the issue persists.'));
  return buildCard(elements, {
    header: header('❌ Error', { color: 'red' }),
    config: { width_mode: 'default' },
  });
}

/**
 * Success card — for confirmations and successful operations.
 */
export function successCard(title: string, body: string): LarkCard {
  const elements: CardElement[] = [md(body)];
  return buildCard(elements, {
    header: header(`✅ ${title}`, { color: 'green' }),
    config: { width_mode: 'default' },
  });
}

/**
 * Info card — neutral informational display.
 */
export function infoCard(title: string, body: string, options?: { footer?: string; color?: CardColor }): LarkCard {
  const elements: CardElement[] = [md(body)];
  if (options?.footer) {
    elements.push(divider());
    elements.push(note(options.footer));
  }
  return buildCard(elements, {
    header: header(`ℹ️ ${title}`, { color: options?.color || 'wathet' }),
    config: { width_mode: 'default' },
  });
}

/**
 * Loading card — shown while processing. Can be updated in-place later.
 */
export function loadingCard(message: string): LarkCard {
  return buildCard(
    [md(`⏳ ${message}`)],
    {
      header: header('Processing...', { color: 'grey' }),
      config: { width_mode: 'default', update_multi: true },
    }
  );
}

/**
 * Confirmation card (HITL) — with Approve/Reject buttons.
 * value payload: { action: 'approval_approve'|'approval_reject', instance_code, task_id }
 */
export function confirmationCard(
  body: string,
  options?: { confirmLabel?: string; cancelLabel?: string; destructive?: boolean; pendingId?: string; chatId?: string }
): LarkCard {
  const confirmLabel = options?.confirmLabel || '✅ Approve';
  const cancelLabel = options?.cancelLabel || '❌ Reject';
  const pendingId = options?.pendingId || '';
  const chatId = options?.chatId || '';

  return buildCard(
    [
      md(body),
      divider(),
      actionBlock([
        button(confirmLabel, { action: 'hitl_confirm', pending_id: pendingId, chat_id: chatId }, {
          type: 'primary',
          ...(options?.destructive ? { confirm: { title: 'Confirm', text: 'This action cannot be undone. Proceed?' } } : {})
        }),
        button(cancelLabel, { action: 'hitl_reject', pending_id: pendingId, chat_id: chatId }, { type: 'danger' }),
      ], 'bisect'),
    ],
    {
      header: header('⚠️ Confirmation Required', { color: 'orange' }),
      config: { width_mode: 'default' },
    }
  );
}

/**
 * List card — displays a list of items with optional actions.
 */
export function listCard(
  title: string,
  items: Array<{ label: string; detail?: string; action?: CardElement }>,
  options?: { footer?: string; emptyText?: string; color?: CardColor }
): LarkCard {
  const elements: CardElement[] = [];

  if (items.length === 0) {
    elements.push(md(options?.emptyText || '_No items found._'));
  } else {
    for (const item of items) {
      let line = `**${item.label}**`;
      if (item.detail) line += ` — ${item.detail}`;
      elements.push(md(line));
    }
  }

  if (options?.footer) {
    elements.push(divider());
    elements.push(note(options.footer));
  }

  return buildCard(elements, {
    header: header(title, { color: options?.color || 'blue' }),
    config: { width_mode: 'default' },
  });
}

/**
 * Calendar event card — displays a list of calendar events in a structured format.
 * Each event: summary, time, optional VC link, optional attendees.
 */
export function calendarCard(
  events: Array<{
    summary: string;
    startTime: string; // human-readable
    endTime?: string;
    location?: string;
    vcLink?: string;
    eventId?: string;
    isAllDay?: boolean;
  }>,
  options?: { title?: string; dateRange?: string; emptyText?: string }
): LarkCard {
  const elements: CardElement[] = [];

  if (events.length === 0) {
    elements.push(md(options?.emptyText || '_No events scheduled._'));
  } else {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const timeStr = e.isAllDay ? '📅 All day' : `🕐 ${e.startTime}${e.endTime ? ` → ${e.endTime}` : ''}`;
      let line = `**${i + 1}. ${e.summary}**\n${timeStr}`;
      if (e.location) line += `\n📍 ${e.location}`;
      if (e.vcLink) line += `\n🔗 [Join Meeting](${e.vcLink})`;
      elements.push(md(line));
      if (i < events.length - 1) elements.push(divider());
    }
  }

  const title = options?.title || '📅 Calendar';
  const subtitle = options?.dateRange;

  return buildCard(elements, {
    header: header(title, { color: 'blue', ...(subtitle && { subtitle }) }),
    config: { width_mode: 'default' },
  });
}

/**
 * Task list card — displays tasks with status icons and action buttons.
 */
export function taskListCard(
  tasks: Array<{
    title: string;
    done?: boolean;
    dueDate?: string;
    taskId?: string;
    assignee?: string;
  }>,
  options?: { title?: string; emptyText?: string; showCompleteButton?: boolean }
): LarkCard {
  const elements: CardElement[] = [];

  if (tasks.length === 0) {
    elements.push(md(options?.emptyText || '_No tasks found._'));
  } else {
    for (const task of tasks) {
      const status = task.done ? '✅' : '⬜';
      let line = `${status} **${task.title}**`;
      if (task.dueDate) line += ` — Due: ${task.dueDate}`;
      if (task.assignee) line += ` — 👤 ${task.assignee}`;
      elements.push(md(line));
    }
  }

  return buildCard(elements, {
    header: header(options?.title || '📋 Tasks', { color: 'violet' }),
    config: { width_mode: 'default' },
  });
}

/**
 * Approval list card — shows pending approvals with approve/reject buttons.
 */
export function approvalListCard(
  approvals: Array<{
    title: string;
    status?: string;
    instanceCode?: string;
    taskId?: string;
    submitter?: string;
  }>,
  options?: { emptyText?: string }
): LarkCard {
  const elements: CardElement[] = [];

  if (approvals.length === 0) {
    elements.push(md(options?.emptyText || '_No pending approvals._'));
  } else {
    for (const approval of approvals) {
      let line = `📋 **${approval.title}**`;
      if (approval.submitter) line += `\n👤 Submitted by: ${approval.submitter}`;
      if (approval.status) line += `\nStatus: ${approval.status}`;
      elements.push(md(line));
      if (approval.instanceCode && approval.taskId) {
        elements.push(actionBlock([
          button('✅ Approve', actionValue('approval_approve', { instance_code: approval.instanceCode, task_id: approval.taskId }), { type: 'primary' }),
          button('❌ Reject', actionValue('approval_reject', { instance_code: approval.instanceCode, task_id: approval.taskId }), { type: 'danger' }),
        ], 'bisect'));
      }
      elements.push(divider());
    }
  }

  return buildCard(elements, {
    header: header('📋 Pending Approvals', { color: 'orange' }),
    config: { width_mode: 'default' },
  });
}

/**
 * Search result card — displays search results from KB, web, or Lark docs.
 */
export function searchResultCard(
  query: string,
  results: Array<{
    title: string;
    snippet: string;
    url?: string;
    source?: string;
    score?: number;
  }>,
  options?: { totalResults?: number; searchTime?: string }
): LarkCard {
  const elements: CardElement[] = [];

  if (results.length === 0) {
    elements.push(md(`No results found for **${query}**.`));
  } else {
    elements.push(md(`Found **${options?.totalResults || results.length}** results${options?.searchTime ? ` in ${options.searchTime}` : ''}`));
    elements.push(divider());
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      let line = `**${i + 1}. ${r.title}**`;
      if (r.source) line += ` \[${r.source}\]`;
      line += `\n${r.snippet}`;
      if (r.url) line += `\n[🔗 Read more](${r.url})`;
      elements.push(md(line));
      if (i < results.length - 1) elements.push(divider());
    }
  }

  return buildCard(elements, {
    header: header(`🔍 Search: ${query}`, { color: 'turquoise' }),
    config: { width_mode: 'default' },
  });
}

// ─── Card Action Value Helpers ───────────────────────────────────────────────

/** Create a standardized action value for card button callbacks */
export function actionValue(action: string, params: Record<string, unknown> = {}): Record<string, unknown> {
  return { action, ...params };
}
