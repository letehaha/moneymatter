import type { ChatGoalProgress } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { createChatI18n } from './card-test-fixtures';
import GoalProgress from './goal-progress.vue';

const progress = (overrides: Partial<ChatGoalProgress> = {}): ChatGoalProgress => ({
  currencyCode: 'USD',
  targetAmount: 2000,
  currentValue: 500,
  percent: 25,
  status: 'on_track',
  ...overrides,
});

const mountProgress = ({ before, after }: { before: ChatGoalProgress | null; after: ChatGoalProgress | null }) =>
  mount(GoalProgress, { props: { change: { before, after } }, global: { plugins: [createChatI18n()] } });

describe('GoalProgress', () => {
  it('shows an update as now and after, each with its amount, percent, bar and status', () => {
    const wrapper = mountProgress({
      before: progress(),
      after: progress({ targetAmount: 1000, percent: 50, status: 'ahead' }),
    });

    const before = wrapper.get('[data-testid="goal-progress-before"]');
    const after = wrapper.get('[data-testid="goal-progress-after"]');
    expect(before.text()).toContain('Now');
    expect(before.text()).toContain('$500.00 of $2,000.00 (25%)');
    expect(before.text()).toContain('On track');
    expect(after.text()).toContain('After');
    expect(after.text()).toContain('$500.00 of $1,000.00 (50%)');
    expect(after.text()).toContain('Ahead of schedule');
    expect(after.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('50');
  });

  it('shows a new goal by its starting progress alone', () => {
    const wrapper = mountProgress({ before: null, after: progress({ currentValue: 0, percent: 0 }) });

    expect(wrapper.find('[data-testid="goal-progress-before"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="goal-progress-after"]').text()).toContain('Progress');
  });

  it('shows a deleted goal by the progress it had', () => {
    const wrapper = mountProgress({ before: progress(), after: null });

    expect(wrapper.find('[data-testid="goal-progress-after"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="goal-progress-before"]').text()).toContain('Progress');
  });

  it('shows only the target while the goal currency has no rate', () => {
    const wrapper = mountProgress({
      before: null,
      after: progress({ currentValue: null, percent: null, status: 'no_rate' }),
    });

    const text = wrapper.get('[data-testid="goal-progress-after"]').text();
    expect(text).toContain('$2,000.00');
    expect(text).not.toContain(' of ');
    expect(text).toContain('No exchange rate for the goal currency');
  });
});
