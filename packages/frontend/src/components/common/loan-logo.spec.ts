import type { LoanApi } from '@/api/loans';
import BrandLogo from '@/components/common/brand-logo.vue';
import LoanLogo from '@/components/common/loan-logo.vue';
import { LOAN_TYPE } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

const buildLoan = (overrides: Partial<LoanApi> = {}) =>
  ({
    name: 'ING',
    loanDetails: { loanType: LOAN_TYPE.mortgage },
    logoDomain: null,
    logoInitials: null,
    logoColor: null,
    logoIcon: null,
    logoImageId: null,
    ...overrides,
  }) as LoanApi;

describe('LoanLogo', () => {
  it('renders the logo when the loan has one', () => {
    const wrapper = mount(LoanLogo, { props: { loan: buildLoan({ logoDomain: 'ing.com' }) } });

    expect(wrapper.findComponent(BrandLogo).props('domain')).toBe('ing.com');
  });

  it('falls back to the loan type chip', () => {
    const wrapper = mount(LoanLogo, { props: { loan: buildLoan() } });

    expect(wrapper.findComponent(BrandLogo).exists()).toBe(false);
    expect(wrapper.classes()).toContain('text-loan-mortgage');
    expect(wrapper.find('svg').exists()).toBe(true);
  });
});
