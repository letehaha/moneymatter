import { recordId } from '@common/lib/zod/custom-types';
import { z } from 'zod';

// Amount fields carry decimals (e.g. 100.50); callers convert them to cents after validation.

// Zero is allowed: a register entry can exist without ever moving money (a
// Microsoft Money voided cheque), and such rows must stay editable.
export const nonNegativeAmountSchema = () => z.number().nonnegative('Amount must be 0 or greater').finite();

// For amounts that carry no meaning at zero: a transfer leg that moves nothing,
// a fee that costs nothing, a split that holds no share of its parent.
export const positiveAmountSchema = () => z.number().positive('Amount must be greater than 0').finite();

// A year below 2000 is always a fat-fingered date ("26" for 2026): no ledger
// predates 2000, and such dates poison exchange-rate lookups.
const MIN_TRANSACTION_TIME = new Date('2000-01-01T00:00:00.000Z');

export const transactionTimeSchema = () =>
  z
    .string()
    .datetime({ message: 'Invalid ISO date string' })
    .refine((time) => new Date(time) >= MIN_TRANSACTION_TIME, {
      message: 'Transaction time cannot be before 2000-01-01',
    });

// A Payee link on a write: explicit `null` clears it, `undefined` leaves it untouched.
export const payeeIdSchema = () => recordId().nullable().optional();

export const splitSchema = z.object({
  categoryId: recordId(),
  amount: positiveAmountSchema(),
  note: z.string().max(100, 'Split note must not exceed 100 characters').nullish(),
});

export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const transactionDetailFieldsSchema = {
  externalUrl: z
    .string()
    .max(2048, 'The URL must not exceed 2048 characters.')
    .url('Invalid URL')
    .regex(/^https?:\/\//i, 'Only http(s) URLs are allowed')
    .nullish(),
  externalReference: z.string().max(255, 'The reference must not exceed 255 characters.').nullish(),
  location: locationSchema.nullish(),
};
