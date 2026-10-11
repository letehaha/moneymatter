import { usePanelLayout } from './use-panel-layout';

const setStoredWidth = ({ width }: { width: number }) => localStorage.setItem('budget-plan:panel-width', String(width));

describe('usePanelLayout', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('clamps the stored width between the panel bounds and the available room', () => {
    setStoredWidth({ width: 100 });
    expect(usePanelLayout({ maxWidth: 1000 }).panelWidth.value).toBe(280);

    setStoredWidth({ width: 900 });
    expect(usePanelLayout({ maxWidth: 1000 }).panelWidth.value).toBe(480);
    expect(usePanelLayout({ maxWidth: 400 }).panelWidth.value).toBe(400);

    setStoredWidth({ width: 333.6 });
    expect(usePanelLayout({ maxWidth: 1000 }).panelWidth.value).toBe(334);
  });
});
