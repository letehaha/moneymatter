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

  it('keeps the pace hint off until it is turned on', () => {
    expect(useGridDisplayOptions().paceHint.value).toBe(false);
    localStorage.setItem('budget-plan:pace-hint', 'true');
    expect(useGridDisplayOptions().paceHint.value).toBe(true);
  });
});
