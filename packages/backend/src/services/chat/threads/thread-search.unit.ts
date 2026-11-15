import { describe, expect, it } from '@jest/globals';

import { buildPrefixTsQuery, buildSnippet, buildTitlePattern } from './thread-search';

describe('buildTitlePattern', () => {
  it('wraps the text for a substring match', () => {
    expect(buildTitlePattern({ q: 'budget' })).toBe('%budget%');
  });

  it('escapes the LIKE wildcards and the escape character', () => {
    expect(buildTitlePattern({ q: '100%_\\' })).toBe('%100\\%\\_\\\\%');
  });
});

describe('buildPrefixTsQuery', () => {
  it('turns every word into a prefix term joined with AND', () => {
    expect(buildPrefixTsQuery({ q: 'Coffee spend' })).toBe('Coffee:* & spend:*');
  });

  it('keeps Cyrillic words and digits and drops punctuation and tsquery operators', () => {
    expect(buildPrefixTsQuery({ q: "кава & (витрати) 2026 !'; DROP" })).toBe('кава:* & витрати:* & 2026:* & DROP:*');
  });

  it('returns null when there is no word to search for', () => {
    expect(buildPrefixTsQuery({ q: ' !?-  ' })).toBeNull();
  });

  it('caps the number of terms', () => {
    const terms = buildPrefixTsQuery({ q: 'a b c d e f g h i j k l' })!.split(' & ');

    expect(terms).toHaveLength(8);
  });
});

describe('buildSnippet', () => {
  it('returns short text whole', () => {
    expect(buildSnippet({ text: 'How much did I spend on coffee?', q: 'coffee' })).toBe(
      'How much did I spend on coffee?',
    );
  });

  it('centres a long text on the first match and marks the cut ends', () => {
    const text = `${'lorem ipsum '.repeat(40)}coffee shop total${' dolor sit'.repeat(40)}`;

    const snippet = buildSnippet({ text, q: 'coff' });

    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('coffee shop total');
    expect(snippet.length).toBeLessThan(220);
  });

  it('matches regardless of case and across scripts', () => {
    const text = `${'слово '.repeat(60)}Кава у місті${' слово'.repeat(60)}`;

    expect(buildSnippet({ text, q: 'кава' })).toContain('Кава у місті');
  });

  it('collapses whitespace and newlines into single spaces', () => {
    expect(buildSnippet({ text: 'one\n\n two\t three', q: 'two' })).toBe('one two three');
  });

  it('starts from the beginning when nothing matches', () => {
    const snippet = buildSnippet({ text: 'x'.repeat(500), q: 'zzz' });

    expect(snippet.startsWith('x')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });
});
