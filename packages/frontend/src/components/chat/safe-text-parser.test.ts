import { describe, expect, it } from 'vitest';

import { type SafeBlock, parseSafeText } from './safe-text-parser';

const paragraph = ({ text }: { text: string }) => {
  const [block] = parseSafeText({ text });
  if (block?.type !== 'paragraph') throw new Error('expected a paragraph');
  return block;
};

describe('parseSafeText', () => {
  it('returns no blocks for blank text', () => {
    expect(parseSafeText({ text: '' })).toEqual([]);
    expect(parseSafeText({ text: ' \n\n  ' })).toEqual([]);
  });

  it('parses bold, italic and inline code', () => {
    const { lines } = paragraph({ text: 'a **bold** and _italic_ and `code` end' });

    expect(lines).toEqual([
      [
        { type: 'text', text: 'a ' },
        { type: 'bold', text: 'bold' },
        { type: 'text', text: ' and ' },
        { type: 'italic', text: 'italic' },
        { type: 'text', text: ' and ' },
        { type: 'code', text: 'code' },
        { type: 'text', text: ' end' },
      ],
    ]);
  });

  it('parses dash and star bullets into one list', () => {
    expect(parseSafeText({ text: '- one\n- **two**\n* three' })).toEqual<SafeBlock[]>([
      {
        type: 'list',
        items: [[{ type: 'text', text: 'one' }], [{ type: 'bold', text: 'two' }], [{ type: 'text', text: 'three' }]],
      },
    ]);
  });

  it('keeps single line breaks inside a paragraph and splits paragraphs on a blank line', () => {
    const blocks = parseSafeText({ text: 'first\nsecond\n\nthird' });

    expect(blocks).toEqual<SafeBlock[]>([
      { type: 'paragraph', lines: [[{ type: 'text', text: 'first' }], [{ type: 'text', text: 'second' }]] },
      { type: 'paragraph', lines: [[{ type: 'text', text: 'third' }]] },
    ]);
  });

  it('ends a list at the next plain line', () => {
    const blocks = parseSafeText({ text: '- one\nafter' });

    expect(blocks.map((block) => block.type)).toEqual(['list', 'paragraph']);
  });

  it('handles CRLF line endings', () => {
    expect(parseSafeText({ text: 'a\r\nb' })).toEqual<SafeBlock[]>([
      { type: 'paragraph', lines: [[{ type: 'text', text: 'a' }], [{ type: 'text', text: 'b' }]] },
    ]);
  });

  it('leaves markup characters inside code literal', () => {
    const { lines } = paragraph({ text: '`**not bold** _x_`' });

    expect(lines).toEqual([[{ type: 'code', text: '**not bold** _x_' }]]);
  });

  it('leaves unclosed markers as literal text', () => {
    const { lines } = paragraph({ text: '**open and _open and `open' });

    expect(lines).toEqual([[{ type: 'text', text: '**open and _open and `open' }]]);
  });

  it('does not italicise snake_case words or a lone underscore', () => {
    const { lines } = paragraph({ text: 'use snake_case_name and a _ b' });

    expect(lines).toEqual([[{ type: 'text', text: 'use snake_case_name and a _ b' }]]);
  });

  it('treats empty emphasis as literal text', () => {
    const { lines } = paragraph({ text: '**** and ``' });

    expect(lines).toEqual([[{ type: 'text', text: '**** and ``' }]]);
  });

  it('leaves HTML, links and images as literal text', () => {
    const inputs = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '[click](http://evil.example/x)',
      '![pixel](http://evil.example/p.png?q=secret)',
      '<a href="javascript:alert(1)">x</a>',
    ];

    for (const text of inputs) {
      const { lines } = paragraph({ text });

      expect(lines).toEqual([[{ type: 'text', text }]]);
    }
  });

  it('only ever emits the four inline node types', () => {
    const blocks = parseSafeText({
      text: '**a** <b>x</b> [l](u) ![i](u) _c_ `d`\n- <script>e</script> **f**',
    });
    const inlines = blocks.flatMap((block) => (block.type === 'list' ? block.items : block.lines)).flat();

    for (const node of inlines) {
      expect(['text', 'bold', 'italic', 'code']).toContain(node.type);
      expect(Object.keys(node).sort()).toEqual(['text', 'type']);
    }
  });
});
