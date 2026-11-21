import { nextTick } from 'vue';

import { useResizableWidth } from './use-resizable-width';

const STORAGE_KEY = 'test:width';

const setup = ({ edge }: { edge: 'left' | 'right' }) =>
  useResizableWidth({ storageKey: STORAGE_KEY, minWidth: 100, maxWidth: 400, defaultWidth: 200, edge });

const drag = ({ resizable, deltaX }: { resizable: ReturnType<typeof setup>; deltaX: number }) => {
  const handle = document.createElement('div');
  handle.setPointerCapture = () => {};
  resizable.startResize({ currentTarget: handle, clientX: 500, pointerId: 1 } as unknown as PointerEvent);
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 500 + deltaX }));
};

const release = () => window.dispatchEvent(new MouseEvent('pointerup'));

describe('useResizableWidth', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('widens a right-edge handle on a rightward drag and a left-edge handle on a leftward drag', () => {
    const right = setup({ edge: 'right' });
    drag({ resizable: right, deltaX: 50 });
    release();
    expect(right.width.value).toBe(250);

    localStorage.clear();
    const left = setup({ edge: 'left' });
    drag({ resizable: left, deltaX: 50 });
    release();
    expect(left.width.value).toBe(150);
  });

  it('clamps drags to the bounds, persists, and resets to the default', async () => {
    const resizable = setup({ edge: 'right' });
    drag({ resizable, deltaX: 1000 });
    release();
    expect(resizable.width.value).toBe(400);
    await nextTick();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('400');

    drag({ resizable, deltaX: -1000 });
    release();
    expect(resizable.width.value).toBe(100);

    resizable.resetWidth();
    expect(resizable.width.value).toBe(200);
  });

  it('tracks isResizing and stops following the pointer after release', () => {
    const resizable = setup({ edge: 'right' });
    drag({ resizable, deltaX: 10 });
    expect(resizable.isResizing.value).toBe(true);

    release();
    expect(resizable.isResizing.value).toBe(false);

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 900 }));
    expect(resizable.width.value).toBe(210);
  });

  it('falls back to the default for a corrupted stored value', () => {
    localStorage.setItem(STORAGE_KEY, 'abc');
    expect(setup({ edge: 'right' }).width.value).toBe(200);
  });
});
