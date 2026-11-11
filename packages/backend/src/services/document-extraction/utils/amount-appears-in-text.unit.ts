import { describe, expect, it } from '@jest/globals';

import { amountAppearsInText } from './amount-appears-in-text';

describe('amountAppearsInText', () => {
  it.each([
    ['Card *4821: purchase 1 234,50 UAH at SILPO', 1234.5],
    ['Paid $1,234.56 at Amazon', 1234.56],
    ['Zahlung 1.234,56 EUR bei REWE', 1234.56],
    ['Card *1234 500.00 USD Uber', 500],
    ["Achat CHF 1'250.00 Migros", 1250],
    ['Achat CHF 1’250.00 Migros', 1250],
    ['Rs.1,23,456.00 debited from A/c XX1234', 123456],
    ['INR 12,34,567.50 spent', 1234567.5],
    ['Card *4821 150 000,00 UAH', 150000],
    ['14:32 250 000,00 UAH Rozetka', 250000],
    ['Purchase 1 234,50 UAH', 1234.5],
    ['BHD 1,250.000 at Lulu', 1250],
    ['KWD 1,250.500 at Lulu', 1250.5],
    ['Purchase .99 USD', 0.99],
    ['Purchase 0.99 USD', 0.99],
    ['Purchase 12 EUR', 12],
    ['Purchase 12,- EUR', 12],
    ['Purchase 12.5 EUR', 12.5],
    ['Purchase 500. Balance 100', 500],
    ['Purchase 12.500 IDR', 12500],
  ])('finds the amount in "%s"', (text, amount) => {
    expect(amountAppearsInText({ amount, text })).toBe(true);
  });

  it.each([
    ['Purchase 1 234,50 UAH', 9999],
    ['Purchase 99.99 USD', 9999],
    ['Purchase 1,234.56 USD', 234.56],
    ['Purchase 1,234.56 USD', 1234],
    ['Purchase 1,234.56 USD', 1234.5],
    ['Purchase 1,234.56 USD', 123456],
    ['Purchase 12.50 USD', 1250],
    ['Purchase 10.99 USD', 0.99],
    ['Purchase 100.00 UAH, fee 1.50 UAH', 101.5],
    ['Purchase 5000 UAH', 500],
    ['Purchase 500 UAH', 1e21],
    ['Your code is 482193', 0],
    ['Purchase 0.00 USD', 0],
    ['Purchase 12.50 USD', -12.5],
  ])('rejects "%s" for %d', (text, amount) => {
    expect(amountAppearsInText({ amount, text })).toBe(false);
  });

  // Accepted on purpose: each reading is the right one in some locale, so the guard cannot tell them apart.
  it.each([
    ['Purchase 500,000 IDR', 500],
    ['Purchase 12.500 IDR', 12.5],
    ['Purchase 5 000,00 UAH', 5],
    ['Purchase 1 234,50 UAH', 234.5],
  ])('cannot rule out the misreading of "%s" as %d', (text, amount) => {
    expect(amountAppearsInText({ amount, text })).toBe(true);
  });
});
