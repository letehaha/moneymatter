import { useGridDisplayOptions } from './use-grid-display-options';

const STORAGE_KEY = 'budget-plan:row-bars';

describe('useGridDisplayOptions', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('falls back to the default when storage holds an unknown mode', () => {
    localStorage.setItem(STORAGE_KEY, 'garbage');
    expect(useGridDisplayOptions().rowBars.value).toBe('combined');
  });

  it('reads a stored mode', () => {
    localStorage.setItem(STORAGE_KEY, 'split');
    expect(useGridDisplayOptions().rowBars.value).toBe('split');
  });
});
