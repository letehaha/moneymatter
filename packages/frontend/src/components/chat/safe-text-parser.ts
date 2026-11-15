/**
 * The chat's text subset: bold, italic, inline code, bullet lists and line breaks. It parses to plain
 * data, so the renderer builds elements itself and the text never reaches `v-html`. Everything else,
 * HTML, links and images included, stays literal text.
 */

export interface SafeInline {
  type: 'text' | 'bold' | 'italic' | 'code';
  text: string;
}

export type SafeBlock = { type: 'paragraph'; lines: SafeInline[][] } | { type: 'list'; items: SafeInline[][] };

const BULLET_PATTERN = /^\s*[-*]\s+(.*)$/;
const WORD_CHAR_PATTERN = /[\p{L}\p{N}_]/u;
const WHITESPACE_PATTERN = /\s/;

const isWordChar = ({ char }: { char: string | undefined }) => char !== undefined && WORD_CHAR_PATTERN.test(char);

const isSpace = ({ char }: { char: string | undefined }) => char !== undefined && WHITESPACE_PATTERN.test(char);

interface Span {
  node: SafeInline;
  /** Index of the first character after the span. */
  end: number;
}

const readCode = ({ line, start }: { line: string; start: number }): Span | null => {
  const close = line.indexOf('`', start + 1);
  if (close <= start + 1) return null;

  return { node: { type: 'code', text: line.slice(start + 1, close) }, end: close + 1 };
};

const readBold = ({ line, start }: { line: string; start: number }): Span | null => {
  const close = line.indexOf('**', start + 2);
  if (close <= start + 2) return null;

  return { node: { type: 'bold', text: line.slice(start + 2, close) }, end: close + 2 };
};

/** `_x_` opens after a non-word character and closes before one, so `snake_case_name` stays text. */
const readItalic = ({ line, start }: { line: string; start: number }): Span | null => {
  if (isWordChar({ char: line[start - 1] })) return null;
  const first = line[start + 1];
  if (first === undefined || first === '_' || isSpace({ char: first })) return null;

  for (let close = line.indexOf('_', start + 2); close !== -1; close = line.indexOf('_', close + 1)) {
    if (!isSpace({ char: line[close - 1] }) && !isWordChar({ char: line[close + 1] })) {
      return { node: { type: 'italic', text: line.slice(start + 1, close) }, end: close + 1 };
    }
  }

  return null;
};

const readSpan = ({ line, start }: { line: string; start: number }): Span | null => {
  if (line[start] === '`') return readCode({ line, start });
  if (line.startsWith('**', start)) return readBold({ line, start });
  if (line[start] === '_') return readItalic({ line, start });
  return null;
};

const parseInline = ({ line }: { line: string }): SafeInline[] => {
  const nodes: SafeInline[] = [];
  let literal = '';

  const flush = () => {
    if (literal !== '') nodes.push({ type: 'text', text: literal });
    literal = '';
  };

  let index = 0;
  while (index < line.length) {
    const span = readSpan({ line, start: index });
    if (span) {
      flush();
      nodes.push(span.node);
      index = span.end;
    } else {
      literal += line[index];
      index += 1;
    }
  }
  flush();

  return nodes;
};

export const parseSafeText = ({ text }: { text: string }): SafeBlock[] => {
  const blocks: SafeBlock[] = [];
  let open: SafeBlock | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === '') {
      open = null;
      continue;
    }

    const bullet = BULLET_PATTERN.exec(rawLine);
    if (bullet) {
      if (open?.type !== 'list') {
        open = { type: 'list', items: [] };
        blocks.push(open);
      }
      open.items.push(parseInline({ line: bullet[1] ?? '' }));
      continue;
    }

    if (open?.type !== 'paragraph') {
      open = { type: 'paragraph', lines: [] };
      blocks.push(open);
    }
    open.lines.push(parseInline({ line: rawLine }));
  }

  return blocks;
};
