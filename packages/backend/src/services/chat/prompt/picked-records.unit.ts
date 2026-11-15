import type { ChatClarificationPart } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { pickedRecordsOf } from './picked-records';

const question: ChatClarificationPart = {
  type: 'clarification',
  id: 'q1',
  question: 'Which account?',
  allowFreeText: false,
  multiSelect: false,
  options: [
    { id: 'o1', label: 'Wallet (USD)', record: { kind: 'account', id: 'acc-wallet' } },
    { id: 'o2', label: 'Savings (USD)', record: { kind: 'account', id: 'acc-savings' } },
    { id: 'o3', label: 'Something else' },
  ],
};

describe('pickedRecordsOf', () => {
  it('names the record of the option the user tapped, with the label they saw', () => {
    expect(
      pickedRecordsOf({ answers: [{ clarificationId: 'q1', optionIds: ['o2'] }], clarifications: [question] }),
    ).toEqual([{ kind: 'account', id: 'acc-savings', label: 'Savings (USD)' }]);
  });

  it('names every record of a multi-select answer, and none for an option that stands for no record', () => {
    expect(
      pickedRecordsOf({ answers: [{ clarificationId: 'q1', optionIds: ['o1', 'o2'] }], clarifications: [question] }),
    ).toHaveLength(2);
    expect(
      pickedRecordsOf({ answers: [{ clarificationId: 'q1', optionIds: ['o3'] }], clarifications: [question] }),
    ).toEqual([]);
  });

  it('names nothing for an answer to a question the thread does not hold', () => {
    expect(
      pickedRecordsOf({ answers: [{ clarificationId: 'gone', optionIds: ['o1'] }], clarifications: [question] }),
    ).toEqual([]);
  });
});
