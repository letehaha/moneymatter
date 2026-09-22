/**
 * @jest-environment <rootDir>/src/services/budget-plans/periods/new-york-timezone-environment.ts
 */
import { describe, expect, it } from '@jest/globals';

import { runPeriodEnumeratorCases } from './period-enumerator-cases';

describe('the New York re-run', () => {
  it('really runs in America/New_York', () => {
    expect(new Date(2024, 0, 15).getTimezoneOffset()).toBe(300);
    expect(new Date(2024, 6, 15).getTimezoneOffset()).toBe(240);
  });
});

runPeriodEnumeratorCases();
