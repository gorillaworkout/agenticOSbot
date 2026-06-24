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
  title: string,
  body: string,
  approveValue: Record<string, unknown>,
  rejectValue: Record<string, unknown>
): LarkCard {
  return buildCard(
    [
      md(body),
      divider(),
      actionBlock([
        button('✅ Approve', approveValue, { type: 'primary', confirm: { title: 'Confirm', text: 'Are you sure you want to approve this action?' } }),
        button('❌ Reject', rejectValue, { type: 'danger' }),
      ], 'bisect'),
    ],
    {
      header: header(`⚠️ ${title}`, { color: 'orange' }),
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

// ─── Card Action Value Helpers ───────────────────────────────────────────────

/** Create a standardized action value for card button callbacks */
export function actionValue(action: string, params: Record<string, unknown> = {}): Record<string, unknown> {
  return { action, ...params };
}
