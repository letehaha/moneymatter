import { describe, expect, it } from 'vitest';

import { PANEL_SECTION_TITLES, sanitizePanelSectionLayout } from './use-panel-sections';

const ALL = Object.keys(PANEL_SECTION_TITLES);

describe('sanitizePanelSectionLayout', () => {
  it('keeps the saved order, drops unknown, repeated and prototype keys, appends missing sections', () => {
    const { order, hidden } = sanitizePanelSectionLayout({
      order: ['pace', 'removed', 'constructor', 'pace', 'breakdown'],
      hidden: ['trend', 'toString', 'trend'],
    });

    expect(order.slice(0, 2)).toEqual(['pace', 'breakdown']);
    expect([...order].sort()).toEqual([...ALL].sort());
    expect(hidden).toEqual(['trend']);
  });

  it.each([null, 'abc', [], { order: null, hidden: 'x' }])('falls back to the default for %j', (stored) => {
    expect(sanitizePanelSectionLayout(stored)).toEqual({ order: ALL, hidden: [] });
  });
});
