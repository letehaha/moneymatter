import { describe, expect, it } from 'vitest';

import { resolveRename } from './resolve-rename';

describe('resolveRename', () => {
  it('submits a trimmed name when it differs from the current one', () => {
    expect(resolveRename({ draftName: '  Savings  ', currentName: 'Cash' })).toEqual({
      outcome: 'submit',
      name: 'Savings',
    });
  });

  it('reports an empty draft', () => {
    expect(resolveRename({ draftName: '', currentName: 'Cash' }).outcome).toBe('empty');
  });

  it('treats a whitespace-only draft as empty rather than a rename to blank', () => {
    expect(resolveRename({ draftName: '   ', currentName: 'Cash' }).outcome).toBe('empty');
  });

  it('reports an unchanged draft', () => {
    expect(resolveRename({ draftName: 'Cash', currentName: 'Cash' }).outcome).toBe('unchanged');
  });

  it('treats padding-only edits as unchanged', () => {
    expect(resolveRename({ draftName: '  Cash  ', currentName: 'Cash' }).outcome).toBe('unchanged');
  });
});
