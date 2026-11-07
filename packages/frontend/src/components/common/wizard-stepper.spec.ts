import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import WizardStepper from './wizard-stepper.vue';

// jsdom has no layout, so the stepper measures 0px wide unless a test overrides it.
const stepperWidth = vi.hoisted(() => ({ value: 0 }));
vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>();
  const { ref } = await import('vue');
  return { ...actual, useElementSize: () => ({ width: ref(stepperWidth.value), height: ref(0), stop: () => {} }) };
});

// Labels resolve to their raw keys (no messages registered), which is all the
// navigability assertions below need — they key off aria-label, not copy.
const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false });

// ResponsiveTooltip pulls in useMediaQuery (matchMedia) and tooltip/popover
// providers that jsdom lacks; stub it to a passthrough so only the step buttons
// are exercised.
const mountStepper = ({
  currentStepKey,
  completedStepKeys,
  alwaysShowLabels = false,
}: {
  currentStepKey: string;
  completedStepKeys: Set<string>;
  alwaysShowLabels?: boolean;
}) =>
  mount(WizardStepper, {
    props: {
      steps: [
        { key: 'upload', labelKey: 'upload' },
        { key: 'map', labelKey: 'map' },
        { key: 'review', labelKey: 'review' },
      ],
      currentStepKey,
      completedStepKeys,
      alwaysShowLabels,
    },
    global: {
      plugins: [i18n],
      stubs: { ResponsiveTooltip: { template: '<div><slot /></div>' } },
    },
  });

const stepButton = (wrapper: ReturnType<typeof mountStepper>, key: string) =>
  wrapper.get(`button[aria-label="${key}"]`);

describe('WizardStepper — forward-jump guard', () => {
  it('disables a completed step that sits ahead of the current step', () => {
    // Review was completed on a prior run; user has since jumped back to Map.
    const wrapper = mountStepper({
      currentStepKey: 'map',
      completedStepKeys: new Set(['upload', 'map', 'review']),
    });

    expect(stepButton(wrapper, 'review').attributes('disabled')).toBeDefined();
  });

  it('does not emit navigate when a forward completed step is clicked', async () => {
    const wrapper = mountStepper({
      currentStepKey: 'map',
      completedStepKeys: new Set(['upload', 'map', 'review']),
    });

    await stepButton(wrapper, 'review').trigger('click');

    expect(wrapper.emitted('navigate')?.some(([key]) => key === 'review')).not.toBe(true);
  });

  it('keeps completed steps at or behind the current step clickable', async () => {
    const wrapper = mountStepper({
      currentStepKey: 'map',
      completedStepKeys: new Set(['upload', 'map', 'review']),
    });

    // Behind the current step.
    const uploadButton = stepButton(wrapper, 'upload');
    expect(uploadButton.attributes('disabled')).toBeUndefined();
    await uploadButton.trigger('click');
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['upload']);

    // At the current step.
    expect(stepButton(wrapper, 'map').attributes('disabled')).toBeUndefined();
  });

  it('leaves a not-yet-completed step disabled', () => {
    // Fresh run: only upload done, sitting on Map, Review never reached.
    const wrapper = mountStepper({
      currentStepKey: 'map',
      completedStepKeys: new Set(['upload']),
    });

    expect(stepButton(wrapper, 'review').attributes('disabled')).toBeDefined();
  });
});

describe('WizardStepper — current step', () => {
  it('leaves the current step enabled before it is completed, without emitting navigate on click', async () => {
    const wrapper = mountStepper({ currentStepKey: 'upload', completedStepKeys: new Set() });

    expect(stepButton(wrapper, 'upload').attributes('disabled')).toBeUndefined();
    await stepButton(wrapper, 'upload').trigger('click');
    expect(wrapper.emitted('navigate')).toBeUndefined();
  });
});

describe('WizardStepper — labels', () => {
  const hasLabel = (wrapper: ReturnType<typeof mountStepper>, key: string) =>
    stepButton(wrapper, key).text().includes(key);

  afterEach(() => {
    stepperWidth.value = 0;
  });

  it('renders only the current label on a narrow stepper, keeping aria-label on every step', () => {
    const wrapper = mountStepper({ currentStepKey: 'map', completedStepKeys: new Set(['upload']) });

    expect(hasLabel(wrapper, 'map')).toBe(true);
    expect(hasLabel(wrapper, 'upload')).toBe(false);
    expect(hasLabel(wrapper, 'review')).toBe(false);
    expect(wrapper.findAll('button[aria-label]')).toHaveLength(3);
  });

  it('renders every label on a wide stepper', () => {
    stepperWidth.value = 768;
    const wrapper = mountStepper({ currentStepKey: 'map', completedStepKeys: new Set(['upload']) });

    for (const key of ['upload', 'map', 'review']) {
      expect(hasLabel(wrapper, key)).toBe(true);
    }
  });

  it('renders every label with alwaysShowLabels on a narrow stepper', () => {
    const wrapper = mountStepper({
      currentStepKey: 'map',
      completedStepKeys: new Set(['upload']),
      alwaysShowLabels: true,
    });

    for (const key of ['upload', 'map', 'review']) {
      expect(hasLabel(wrapper, key)).toBe(true);
    }
  });
});

describe('WizardStepper — back-navigation hover state', () => {
  it('marks only navigable completed steps behind the current one as group/step', () => {
    const wrapper = mountStepper({
      currentStepKey: 'map',
      completedStepKeys: new Set(['upload', 'map', 'review']),
    });

    expect(stepButton(wrapper, 'upload').classes()).toContain('group/step');
    expect(stepButton(wrapper, 'map').classes()).not.toContain('group/step');
    expect(stepButton(wrapper, 'review').classes()).not.toContain('group/step');
  });
});
