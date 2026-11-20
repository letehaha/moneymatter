import { type EffectScope, effectScope, nextTick, ref } from 'vue';

import { useSlidingIndicator } from './use-sliding-indicator';

const place = ({ el, top, height = 36 }: { el: HTMLElement; top: number; height?: number }) => {
  el.getBoundingClientRect = () => ({ top, left: 10, width: 200, height }) as DOMRect;
};

const item = ({ top }: { top: number }) => {
  const el = document.createElement('a');
  place({ el, top });
  return el;
};

let scope: EffectScope;
let resizeCallbacks: (() => void)[];
let animate: ReturnType<typeof vi.fn>;

const setup = () => {
  const container = document.createElement('div');
  place({ el: container, top: 100, height: 400 });
  const first = item({ top: 110 });
  const second = item({ top: 190 });
  const pill = document.createElement('div');
  pill.setAttribute('data-sliding-indicator', '');
  place({ el: pill, top: 110 });
  pill.animate = animate as unknown as HTMLElement['animate'];
  container.append(pill, first, second);

  const key = ref('first');
  const containerRef = ref<HTMLElement | null>(container);
  const { indicator } = scope.run(() =>
    useSlidingIndicator({ containerRef, activeSelector: '.on', activeKey: () => key.value }),
  )!;
  const has = (needle: string) => indicator.value.class.some((c) => typeof c === 'string' && c.includes(needle));
  return {
    container,
    pill,
    first,
    second,
    key,
    containerRef,
    indicator,
    isSliding: () => animate.mock.calls.length > 0,
    isHidden: () => has('hidden'),
    isTransparent: () => has('opacity-0'),
  };
};

// MutationObserver callbacks land a microtask after the class change.
const settle = async () => {
  await nextTick();
  await nextTick();
};

describe('useSlidingIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    resizeCallbacks = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resizeCallbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    animate = vi.fn(() => ({ cancel: vi.fn() }));
    scope = effectScope();
  });

  afterEach(() => {
    scope.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('places the pill over the active element without sliding the first time', async () => {
    const { first, indicator, isSliding, isHidden } = setup();
    await settle();
    expect(isHidden()).toBe(true);

    first.classList.add('on');
    await settle();

    expect(indicator.value.style).toEqual({ top: '10px', left: '0px', width: '200px', height: '36px' });
    expect(isHidden()).toBe(false);
    expect(isSliding()).toBe(false);
  });

  it('slides from where the pill is when the key changes', async () => {
    const { first, second, key, indicator } = setup();
    first.classList.add('on');
    await settle();

    key.value = 'second';
    first.classList.remove('on');
    second.classList.add('on');
    await settle();

    expect(indicator.value.style?.top).toBe('90px');
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0]![0]).toEqual([
      { transform: 'translate(0px, -80px) scale(1, 1)' },
      { transform: 'none' },
    ]);
  });

  it('follows a resize of the same item instantly', async () => {
    const { first, indicator, isSliding } = setup();
    first.classList.add('on');
    await settle();

    place({ el: first, top: 150 });
    resizeCallbacks.forEach((callback) => callback());

    expect(indicator.value.style?.top).toBe('50px');
    expect(isSliding()).toBe(false);
  });

  it('does not slide when the active element is re-mounted under the same key', async () => {
    const { container, first, indicator, isSliding } = setup();
    first.classList.add('on');
    await settle();

    const remounted = item({ top: 130 });
    remounted.classList.add('on');
    first.replaceWith(remounted);
    await settle();

    expect(indicator.value.style?.top).toBe('30px');
    expect(isSliding()).toBe(false);
    expect(container.contains(first)).toBe(false);
  });

  it('does not treat a geometry change as a slide after the key changed without moving the item', async () => {
    const { first, key, indicator, isSliding } = setup();
    first.classList.add('on');
    await settle();

    key.value = 'first-nested';
    await settle();
    vi.advanceTimersByTime(200);

    place({ el: first, top: 150 });
    resizeCallbacks.forEach((callback) => callback());

    expect(indicator.value.style?.top).toBe('50px');
    expect(isSliding()).toBe(false);
  });

  it('slides on from the last position across a brief gap with no active element', async () => {
    const { first, second, key, indicator, isSliding, isHidden, isTransparent } = setup();
    first.classList.add('on');
    await settle();

    key.value = 'second';
    first.classList.remove('on');
    await settle();
    expect(isTransparent()).toBe(true);
    expect(isHidden()).toBe(false);

    second.classList.add('on');
    await settle();

    expect(indicator.value.style?.top).toBe('90px');
    expect(isTransparent()).toBe(false);
    expect(isSliding()).toBe(true);

    vi.advanceTimersByTime(200);
    expect(isHidden()).toBe(false);
    expect(indicator.value.style?.top).toBe('90px');
  });

  it('continues an interrupted slide from where the pill is on screen', async () => {
    const { pill, first, second, key, indicator } = setup();
    first.classList.add('on');
    await settle();

    const cancel = vi.fn(() => place({ el: pill, top: 190 }));
    animate.mockReturnValueOnce({ cancel });
    key.value = 'second';
    first.classList.remove('on');
    second.classList.add('on');
    await settle();

    pill.getBoundingClientRect = () => ({ top: 150, left: 10, width: 100, height: 36 }) as DOMRect;
    key.value = 'first';
    second.classList.remove('on');
    first.classList.add('on');
    await settle();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(indicator.value.style?.top).toBe('10px');
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.calls[1]![0]).toEqual([
      { transform: 'translate(0px, 40px) scale(0.5, 1)' },
      { transform: 'none' },
    ]);
  });

  it('jumps without animating when reduced motion is preferred', async () => {
    const { first, second, key, indicator } = setup();
    first.classList.add('on');
    await settle();

    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    key.value = 'second';
    first.classList.remove('on');
    second.classList.add('on');
    await settle();

    expect(animate).not.toHaveBeenCalled();
    expect(indicator.value.style?.top).toBe('90px');
  });

  it('forgets the position when nothing stays active, so the next placement is instant', async () => {
    const { first, second, key, isSliding, isHidden } = setup();
    first.classList.add('on');
    await settle();

    first.classList.remove('on');
    await settle();
    vi.advanceTimersByTime(200);
    expect(isHidden()).toBe(true);

    key.value = 'second';
    second.classList.add('on');
    await settle();

    expect(isHidden()).toBe(false);
    expect(isSliding()).toBe(false);
  });

  it('does not slide back in after the container was gone', async () => {
    const { container, first, second, key, containerRef, isSliding, isHidden } = setup();
    first.classList.add('on');
    await settle();

    containerRef.value = null;
    await settle();
    expect(isHidden()).toBe(true);

    key.value = 'second';
    first.classList.remove('on');
    second.classList.add('on');
    containerRef.value = container;
    await settle();

    expect(isHidden()).toBe(false);
    expect(isSliding()).toBe(false);
  });
});
