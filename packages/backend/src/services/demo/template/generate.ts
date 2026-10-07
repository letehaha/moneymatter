import { PAYMENT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { faker } from '@faker-js/faker';
import { addDays, eachDayOfInterval, endOfMonth, isWeekend, setDate, startOfMonth, subMonths } from 'date-fns';

import { DEMO_CONFIG, type DemoAccountKey } from '../demo-config';
import { rateForDayOffset } from './fx';
import { DEMO_MERCHANTS, INSTITUTIONAL_MERCHANTS, type DemoMerchant } from './merchants';
import type {
  DemoTemplate,
  DemoTemplateGroup,
  DemoTemplateRefund,
  DemoTemplateSplit,
  DemoTemplateSubscriptionPayment,
  DemoTemplateTransaction,
} from './types';

/**
 * Plausible times of day per kind of spending, so a day's transactions read in
 * a sensible order instead of sharing one timestamp.
 */
const TIME_WINDOWS = {
  earlyMorning: [6 * 60, 9 * 60],
  morning: [8 * 60, 11 * 60],
  midday: [11 * 60 + 30, 14 * 60],
  afternoon: [14 * 60, 18 * 60],
  evening: [18 * 60, 22 * 60],
  businessHours: [9 * 60, 17 * 60],
} as const satisfies Record<string, readonly [number, number]>;

type TimeWindow = keyof typeof TIME_WINDOWS;

const MS_PER_DAY = 86400000;

function daysBetween({ from, to }: { from: Date; to: Date }): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY));
}

const pick = <T>(items: readonly T[]): T => faker.helpers.arrayElement(items);
const cents = ({ min, max }: { min: number; max: number }) => faker.number.int({ min, max });

/**
 * Builds the template for one demo dataset.
 *
 * Seeded faker keeps every demo user's history identical, so budget limits can
 * be derived from the data and screenshots stay stable.
 */
export function generateDemoTemplate({ generatedAt = new Date() }: { generatedAt?: Date } = {}): DemoTemplate {
  faker.seed(12345);

  // Anchored to a month boundary so the oldest month is whole. Starting
  // mid-month keeps that month's bills but drops the payday on the 1st, which
  // overdraws checking for the rest of the history.
  const startDate = startOfMonth(subMonths(generatedAt, DEMO_CONFIG.historyMonths));

  const transactions: DemoTemplateTransaction[] = [];
  const splits: DemoTemplateSplit[] = [];
  const refunds: DemoTemplateRefund[] = [];
  const groups: DemoTemplateGroup[] = [];
  const subscriptionPayments: DemoTemplateSubscriptionPayment[] = [];

  let refCounter = 0;
  const nextRef = (prefix: string): string => {
    refCounter += 1;
    return `${prefix}-${refCounter}`;
  };

  /**
   * Euro charged to the travel card and not yet paid off.
   *
   * The monthly payoff settles this balance rather than a fixed amount, matching
   * how a card paid in full behaves. A fixed payment would let variable spending
   * drift the balance past the credit limit.
   */
  let travelCardOwed = 0;

  /**
   * The day's drifted rate. A transfer's two legs imply an exchange rate, and
   * `refAmount` must convert at that same rate.
   */
  const rateOn = ({ currencyCode, date }: { currencyCode: 'EUR' | 'PLN'; date: Date }): number =>
    rateForDayOffset({
      currencyCode,
      dayOffset: daysBetween({ from: date, to: generatedAt }),
      spotRate: DEMO_CONFIG.exchangeRates[currencyCode],
    });

  const minuteIn = (window: TimeWindow): number => {
    const [from, to] = TIME_WINDOWS[window];
    return faker.number.int({ min: from, max: to });
  };

  /** Emits a row only if its date falls inside the history window. */
  const emit = (
    date: Date,
    row: Omit<DemoTemplateTransaction, 'dayOffset' | 'minuteOfDay'> & { window: TimeWindow },
  ): DemoTemplateTransaction | null => {
    if (date < startDate || date > generatedAt) return null;

    const { window, ...rest } = row;
    const transaction: DemoTemplateTransaction = {
      ...rest,
      dayOffset: daysBetween({ from: date, to: generatedAt }),
      minuteOfDay: minuteIn(window),
    };
    transactions.push(transaction);
    return transaction;
  };

  /** Emits a spending row against a merchant, taking its category from the merchant. */
  const emitPurchase = ({
    date,
    merchant,
    amount,
    accountKey,
    paymentType,
    window,
    tagKeys,
    ref,
  }: {
    date: Date;
    merchant: DemoMerchant;
    amount: number;
    accountKey: DemoAccountKey;
    paymentType: PAYMENT_TYPES;
    window: TimeWindow;
    tagKeys?: string[];
    ref?: string;
  }) =>
    emit(date, {
      ref,
      accountKey,
      categoryKey: merchant.categoryKey,
      amount,
      transactionType: TRANSACTION_TYPES.expense,
      note: merchant.name,
      merchantName: merchant.name,
      paymentType,
      tagKeys,
      window,
    });

  /** Emits both legs of a transfer between two of the user's own accounts. */
  const emitTransfer = ({
    date,
    fromAccountKey,
    toAccountKey,
    fromAmount,
    toAmount,
    note,
    window,
  }: {
    date: Date;
    fromAccountKey: DemoAccountKey;
    toAccountKey: DemoAccountKey;
    fromAmount: number;
    toAmount: number;
    note: string;
    window: TimeWindow;
  }) => {
    const shared = {
      transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      transferKey: nextRef('transfer'),
      note,
      paymentType: PAYMENT_TYPES.bankTransfer,
      categoryKey: 'other',
      window,
    };

    emit(date, {
      ...shared,
      accountKey: fromAccountKey,
      amount: fromAmount,
      transactionType: TRANSACTION_TYPES.expense,
    });
    emit(date, {
      ...shared,
      accountKey: toAccountKey,
      amount: toAmount,
      transactionType: TRANSACTION_TYPES.income,
    });
  };

  interface MonthContext {
    monthDate: Date;
    monthIndex: number;
    monthStart: Date;
    monthEnd: Date;
    calendarMonth: number;
  }

  const emitMonthlyIncome = ({ monthDate, monthIndex, calendarMonth }: MonthContext) => {
    emit(setDate(monthDate, 1), {
      accountKey: 'main_checking',
      categoryKey: 'income/wage-invoices',
      amount: cents({ min: 520000, max: 580000 }),
      transactionType: TRANSACTION_TYPES.income,
      note: 'Acme Corp payroll',
      merchantName: INSTITUTIONAL_MERCHANTS.employer.name,
      paymentType: PAYMENT_TYPES.bankTransfer,
      window: 'earlyMorning',
    });

    // Freelance work turns up every other month, giving income analytics a
    // second, irregular series instead of one flat salary bar.
    if (monthIndex % 2 === 1) {
      emit(setDate(monthDate, faker.number.int({ min: 14, max: 22 })), {
        accountKey: 'main_checking',
        categoryKey: 'income/freelance',
        amount: cents({ min: 60000, max: 240000 }),
        transactionType: TRANSACTION_TYPES.income,
        note: 'Freelance invoice',
        merchantName: INSTITUTIONAL_MERCHANTS.freelanceClient.name,
        paymentType: PAYMENT_TYPES.bankTransfer,
        window: 'businessHours',
      });
    }

    if (calendarMonth % 3 === 2) {
      emit(setDate(monthDate, 18), {
        accountKey: 'main_checking',
        categoryKey: 'income/interests-dividends',
        amount: cents({ min: 8000, max: 26000 }),
        transactionType: TRANSACTION_TYPES.income,
        note: 'Quarterly dividend',
        merchantName: INSTITUTIONAL_MERCHANTS.brokerage.name,
        paymentType: PAYMENT_TYPES.bankTransfer,
        window: 'businessHours',
      });
    }

    // December bonus, the one big spike in the income series.
    if (calendarMonth === 11) {
      emit(setDate(monthDate, 20), {
        accountKey: 'main_checking',
        categoryKey: 'income/wage-invoices',
        amount: cents({ min: 300000, max: 600000 }),
        transactionType: TRANSACTION_TYPES.income,
        note: 'Annual bonus',
        merchantName: INSTITUTIONAL_MERCHANTS.employer.name,
        paymentType: PAYMENT_TYPES.bankTransfer,
        window: 'businessHours',
      });
    }

    emit(setDate(monthDate, 28), {
      accountKey: 'savings',
      categoryKey: 'income/interests-dividends',
      amount: cents({ min: 900, max: 4200 }),
      transactionType: TRANSACTION_TYPES.income,
      note: 'Savings interest',
      paymentType: PAYMENT_TYPES.bankTransfer,
      window: 'earlyMorning',
    });
  };

  const emitRecurringBills = ({ monthDate, calendarMonth }: MonthContext) => {
    emit(setDate(monthDate, 5), {
      accountKey: 'main_checking',
      categoryKey: 'housing/rent',
      amount: 140000,
      transactionType: TRANSACTION_TYPES.expense,
      note: 'Monthly rent',
      merchantName: INSTITUTIONAL_MERCHANTS.landlord.name,
      paymentType: PAYMENT_TYPES.bankTransfer,
      tagKeys: ['must'],
      window: 'morning',
    });

    emit(setDate(monthDate, 20), {
      accountKey: 'main_checking',
      categoryKey: 'housing/energy-utilities',
      amount: cents({ min: 8000, max: 18000 }),
      transactionType: TRANSACTION_TYPES.expense,
      note: 'Electricity and gas',
      merchantName: INSTITUTIONAL_MERCHANTS.utility.name,
      paymentType: PAYMENT_TYPES.bankTransfer,
      tagKeys: ['must'],
      window: 'businessHours',
    });

    emit(setDate(monthDate, 25), {
      accountKey: 'main_checking',
      categoryKey: 'communication/internet',
      amount: 6500,
      transactionType: TRANSACTION_TYPES.expense,
      note: 'Home internet',
      merchantName: INSTITUTIONAL_MERCHANTS.internet.name,
      paymentType: PAYMENT_TYPES.bankTransfer,
      tagKeys: ['must'],
      window: 'businessHours',
    });

    emit(setDate(monthDate, 3), {
      accountKey: 'main_checking',
      categoryKey: 'communication/phone-cell-phone',
      amount: 4500,
      transactionType: TRANSACTION_TYPES.expense,
      note: 'Mobile plan',
      merchantName: INSTITUTIONAL_MERCHANTS.mobile.name,
      paymentType: PAYMENT_TYPES.debitCard,
      tagKeys: ['must'],
      window: 'businessHours',
    });

    emitPurchase({
      date: setDate(monthDate, 1),
      merchant: DEMO_MERCHANTS.fitness[0]!,
      amount: 4500,
      accountKey: 'main_checking',
      paymentType: PAYMENT_TYPES.debitCard,
      window: 'morning',
      tagKeys: ['want'],
    });

    emit(setDate(monthDate, 7), {
      accountKey: 'main_checking',
      categoryKey: 'financial-expenses/charges-fees',
      amount: 1200,
      transactionType: TRANSACTION_TYPES.expense,
      note: 'Account maintenance fee',
      merchantName: INSTITUTIONAL_MERCHANTS.bank.name,
      paymentType: PAYMENT_TYPES.bankTransfer,
      tagKeys: ['must'],
      window: 'earlyMorning',
    });

    // Car insurance is billed twice a year, so the category sits empty most
    // months and spikes twice, a pattern a flat monthly bill never shows.
    if (calendarMonth === 0 || calendarMonth === 6) {
      emit(setDate(monthDate, 10), {
        accountKey: 'main_checking',
        categoryKey: 'vehicle/vehicle-insurance',
        amount: cents({ min: 32000, max: 38000 }),
        transactionType: TRANSACTION_TYPES.expense,
        note: 'Auto insurance premium',
        merchantName: INSTITUTIONAL_MERCHANTS.carInsurance.name,
        paymentType: PAYMENT_TYPES.bankTransfer,
        tagKeys: ['must'],
        window: 'businessHours',
      });
    }

    // Quarterly instalments with a larger April settlement, so tax analytics
    // get a lumpy series, not one bar a year.
    if (calendarMonth % 3 === 0) {
      const isSettlement = calendarMonth === 3;
      emit(setDate(monthDate, 15), {
        accountKey: 'main_checking',
        categoryKey: 'financial-expenses/taxes',
        amount: isSettlement ? cents({ min: 60000, max: 130000 }) : cents({ min: 45000, max: 80000 }),
        transactionType: TRANSACTION_TYPES.expense,
        note: isSettlement ? 'Income tax settlement' : 'Estimated tax payment',
        paymentType: PAYMENT_TYPES.bankTransfer,
        tagKeys: ['must'],
        window: 'businessHours',
      });
    }
  };

  const emitSubscriptionCharges = ({ monthDate }: MonthContext) => {
    for (const subscription of DEMO_CONFIG.subscriptions) {
      const dueDate = setDate(monthDate, subscription.dayOfMonth);
      const ref = nextRef('sub');

      const emitted = emit(dueDate, {
        ref,
        accountKey: 'main_checking',
        categoryKey: subscription.categoryKey,
        amount: subscription.expectedAmount,
        transactionType: TRANSACTION_TYPES.expense,
        note: subscription.name,
        merchantName: subscription.name,
        paymentType: PAYMENT_TYPES.debitCard,
        tagKeys: ['subscription'],
        window: 'earlyMorning',
      });

      if (emitted) {
        subscriptionPayments.push({
          subscriptionName: subscription.name,
          transactionRef: ref,
          dueDayOffset: daysBetween({ from: dueDate, to: generatedAt }),
        });
      }
    }
  };

  const emitTransfers = ({ monthDate, monthIndex }: MonthContext) => {
    const sweep = cents({ min: 140000, max: 190000 });
    emitTransfer({
      date: setDate(monthDate, 2),
      fromAccountKey: 'main_checking',
      toAccountKey: 'savings',
      fromAmount: sweep,
      toAmount: sweep,
      note: 'Monthly savings transfer',
      window: 'earlyMorning',
    });

    const withdrawalUsd = cents({ min: 8000, max: 16000 });
    const withdrawalDate = setDate(monthDate, faker.number.int({ min: 8, max: 14 }));
    emitTransfer({
      date: withdrawalDate,
      fromAccountKey: 'main_checking',
      toAccountKey: 'cash',
      fromAmount: withdrawalUsd,
      toAmount: Math.round(withdrawalUsd * rateOn({ currencyCode: 'PLN', date: withdrawalDate })),
      note: 'ATM withdrawal',
      window: 'afternoon',
    });

    // Settles what the card ran up in earlier months, so its balance stays
    // inside the credit limit the utilization widget reads against.
    if (travelCardOwed > 0) {
      const payoffDate = setDate(monthDate, 26);
      emitTransfer({
        date: payoffDate,
        fromAccountKey: 'main_checking',
        toAccountKey: 'travel_card',
        fromAmount: Math.round(travelCardOwed / rateOn({ currencyCode: 'EUR', date: payoffDate })),
        toAmount: travelCardOwed,
        note: 'Travel card payment',
        window: 'businessHours',
      });
      travelCardOwed = 0;
    }

    // Occasional raid on savings, so the savings line is not a straight climb.
    if (monthIndex % 11 === 7) {
      const raid = cents({ min: 90000, max: 160000 });
      emitTransfer({
        date: setDate(monthDate, 17),
        fromAccountKey: 'savings',
        toAccountKey: 'main_checking',
        fromAmount: raid,
        toAmount: raid,
        note: 'Transfer from savings',
        window: 'businessHours',
      });
    }
  };

  const emitGroceryRun = (day: Date) => {
    const merchant = pick(DEMO_MERCHANTS.groceries);
    const amount = cents({ min: 4000, max: 12000 });
    const isBigShop = amount > 10000 && faker.number.int({ min: 1, max: 6 }) === 1;
    const ref = isBigShop ? nextRef('shop') : undefined;

    const emitted = emitPurchase({
      date: day,
      merchant,
      amount,
      accountKey: 'main_checking',
      paymentType: PAYMENT_TYPES.debitCard,
      window: 'afternoon',
      tagKeys: ['need'],
      ref,
    });

    // A big-box run rarely means food alone, so this shows a split transaction
    // instead of one flat category.
    //
    // Splits must cover the full amount: budget stats skip a parent that has
    // splits and count the split rows instead, so a leftover remainder would
    // land in no budget.
    if (ref && emitted) {
      const household = Math.round(amount * 0.3);
      const pharmacy = Math.round(amount * 0.12);

      splits.push(
        { transactionRef: ref, categoryKey: 'shopping/home-garden', amount: household, note: 'Household' },
        { transactionRef: ref, categoryKey: 'shopping/drugstore-chemist', amount: pharmacy, note: 'Pharmacy' },
        {
          transactionRef: ref,
          categoryKey: 'food/groceries',
          amount: amount - household - pharmacy,
          note: 'Groceries',
        },
      );
    }
  };

  const emitShoppingTrip = (day: Date) => {
    const merchant = pick(DEMO_MERCHANTS.shopping);
    const amount = cents({ min: 4000, max: 42000 });
    const isReturned = faker.number.int({ min: 1, max: 9 }) === 1;
    const ref = isReturned ? nextRef('purchase') : undefined;

    const purchase = emitPurchase({
      date: day,
      merchant,
      amount,
      accountKey: 'main_checking',
      paymentType: PAYMENT_TYPES.debitCard,
      window: 'afternoon',
      tagKeys: ['want'],
      ref,
    });

    if (!ref || !purchase) return;

    const refundRef = nextRef('refund');
    const refund = emit(addDays(day, faker.number.int({ min: 4, max: 18 })), {
      ref: refundRef,
      accountKey: 'main_checking',
      categoryKey: 'income/refunds',
      amount,
      transactionType: TRANSACTION_TYPES.income,
      note: `Return: ${merchant.name}`,
      merchantName: merchant.name,
      paymentType: PAYMENT_TYPES.debitCard,
      window: 'afternoon',
    });

    // Link only once both rows landed inside the window, otherwise the pair
    // would reference a row that was never emitted.
    if (refund) {
      refunds.push({ originalRef: ref, refundRef });
    }
  };

  const emitDailySpending = ({ monthStart, monthEnd }: MonthContext) => {
    for (const day of eachDayOfInterval({ start: monthStart, end: monthEnd })) {
      if (day < startDate || day > generatedAt) continue;

      if (faker.number.int({ min: 1, max: 3 }) === 1) emitGroceryRun(day);

      if (faker.number.int({ min: 1, max: 5 }) === 1) {
        emitPurchase({
          date: day,
          merchant: pick(DEMO_MERCHANTS.restaurants),
          amount: cents({ min: 2500, max: 8000 }),
          accountKey: 'main_checking',
          paymentType: PAYMENT_TYPES.debitCard,
          window: 'evening',
          tagKeys: ['want'],
        });
      }

      if (!isWeekend(day) && faker.number.int({ min: 1, max: 3 }) === 1) {
        emitPurchase({
          date: day,
          merchant: pick(DEMO_MERCHANTS.coffee),
          amount: cents({ min: 400, max: 900 }),
          accountKey: 'main_checking',
          paymentType: PAYMENT_TYPES.debitCard,
          window: 'earlyMorning',
          tagKeys: ['want'],
        });
      }

      if (day.getDay() === 6 && faker.number.int({ min: 1, max: 2 }) === 1) {
        emitPurchase({
          date: day,
          merchant: pick(DEMO_MERCHANTS.fuel),
          amount: cents({ min: 3500, max: 7500 }),
          accountKey: 'main_checking',
          paymentType: PAYMENT_TYPES.debitCard,
          window: 'midday',
          tagKeys: ['need'],
        });
      }

      if (!isWeekend(day) && faker.number.int({ min: 1, max: 8 }) === 1) {
        emitPurchase({
          date: day,
          merchant: pick(DEMO_MERCHANTS.transit),
          amount: cents({ min: 900, max: 4200 }),
          accountKey: 'main_checking',
          paymentType: PAYMENT_TYPES.debitCard,
          window: 'evening',
          tagKeys: ['need'],
        });
      }

      if (faker.number.int({ min: 1, max: 22 }) === 1) {
        emitPurchase({
          date: day,
          merchant: pick(DEMO_MERCHANTS.parking),
          amount: cents({ min: 800, max: 3000 }),
          accountKey: 'main_checking',
          paymentType: PAYMENT_TYPES.debitCard,
          window: 'afternoon',
        });
      }

      if (faker.number.int({ min: 1, max: 12 }) === 1) emitShoppingTrip(day);

      if (faker.number.int({ min: 1, max: 26 }) === 1) {
        emitPurchase({
          date: day,
          merchant: pick(DEMO_MERCHANTS.pharmacy),
          amount: cents({ min: 1200, max: 6500 }),
          accountKey: 'main_checking',
          paymentType: PAYMENT_TYPES.debitCard,
          window: 'evening',
          tagKeys: ['need'],
        });
      }

      if (faker.number.int({ min: 1, max: 18 }) === 1) {
        emitPurchase({
          date: day,
          merchant: pick(DEMO_MERCHANTS.entertainment),
          amount: cents({ min: 1500, max: 9000 }),
          accountKey: 'main_checking',
          paymentType: PAYMENT_TYPES.debitCard,
          window: 'evening',
          tagKeys: ['want'],
        });
      }

      if (faker.number.int({ min: 1, max: 40 }) === 1) {
        emitPurchase({
          date: day,
          merchant: pick(DEMO_MERCHANTS.education),
          amount: cents({ min: 1500, max: 12000 }),
          accountKey: 'main_checking',
          paymentType: PAYMENT_TYPES.debitCard,
          window: 'evening',
        });
      }

      if (faker.number.int({ min: 1, max: 70 }) === 1) {
        emitPurchase({
          date: day,
          merchant: pick(DEMO_MERCHANTS.health),
          amount: cents({ min: 4000, max: 26000 }),
          accountKey: 'main_checking',
          paymentType: PAYMENT_TYPES.debitCard,
          window: 'morning',
          tagKeys: ['need'],
        });
      }

      if (faker.number.int({ min: 1, max: 90 }) === 1) {
        emit(day, {
          accountKey: 'main_checking',
          categoryKey: 'vehicle/vehicle-maintenance',
          amount: cents({ min: 8000, max: 65000 }),
          transactionType: TRANSACTION_TYPES.expense,
          note: 'Vehicle service',
          merchantName: INSTITUTIONAL_MERCHANTS.carService.name,
          paymentType: PAYMENT_TYPES.debitCard,
          tagKeys: ['need'],
          window: 'morning',
        });
      }
    }
  };

  const emitTravelCardSpending = ({ monthStart, monthEnd, monthIndex }: MonthContext) => {
    // Steady euro spending every month, so the EUR account reads as a real
    // account rather than a handful of rows.
    const routineCount = faker.number.int({ min: 2, max: 5 });
    for (let index = 0; index < routineCount; index += 1) {
      const amount = cents({ min: 1800, max: 9000 });
      const emitted = emitPurchase({
        date: faker.date.between({ from: monthStart, to: monthEnd }),
        merchant: pick(DEMO_MERCHANTS.travelDining),
        amount,
        accountKey: 'travel_card',
        paymentType: PAYMENT_TYPES.creditCard,
        window: 'evening',
        tagKeys: ['want'],
      });

      if (emitted) travelCardOwed += amount;
    }

    if (monthIndex % 5 !== 3) return;

    // Two or three times a year the euro spending clusters into a trip, which
    // becomes a transaction group.
    const tripStart = faker.date.between({ from: monthStart, to: monthEnd });
    const tripRefs: string[] = [];

    const legs = [
      {
        date: tripStart,
        merchants: [DEMO_MERCHANTS.travel[2]!, DEMO_MERCHANTS.travel[3]!, DEMO_MERCHANTS.travel[4]!],
        amount: cents({ min: 12000, max: 46000 }),
        window: 'morning' as TimeWindow,
        tagKeys: ['vacation'],
      },
      {
        date: addDays(tripStart, 1),
        merchants: [DEMO_MERCHANTS.travel[0]!, DEMO_MERCHANTS.travel[1]!],
        amount: cents({ min: 18000, max: 62000 }),
        window: 'afternoon' as TimeWindow,
        tagKeys: ['vacation'],
      },
      {
        // travelDining lists restaurants first, so this leg's merchant is a
        // meal, not a transit or lodging entry from the same mixed bucket.
        date: addDays(tripStart, 2),
        merchants: [DEMO_MERCHANTS.travelDining[0]!, DEMO_MERCHANTS.travelDining[1]!],
        amount: cents({ min: 3500, max: 14000 }),
        window: 'evening' as TimeWindow,
        tagKeys: ['vacation', 'reimbursable'],
      },
    ];

    for (const leg of legs) {
      const ref = nextRef('trip');
      const emitted = emitPurchase({
        date: leg.date,
        merchant: pick(leg.merchants),
        amount: leg.amount,
        accountKey: 'travel_card',
        paymentType: PAYMENT_TYPES.creditCard,
        window: leg.window,
        tagKeys: leg.tagKeys,
        ref,
      });

      if (emitted) {
        tripRefs.push(ref);
        travelCardOwed += leg.amount;
      }
    }

    // A group needs at least two members to pass the service's validation.
    if (tripRefs.length >= 2) {
      groups.push({
        name: `Trip to Europe, ${tripStart.toLocaleString('en-US', { month: 'long', year: 'numeric' })}`,
        note: 'Travel, stay and meals for one trip.',
        transactionRefs: tripRefs,
      });
    }
  };

  const emitCashSpending = ({ monthStart, monthEnd }: MonthContext) => {
    const purchaseCount = faker.number.int({ min: 3, max: 7 });
    for (let index = 0; index < purchaseCount; index += 1) {
      emitPurchase({
        date: faker.date.between({ from: monthStart, to: monthEnd }),
        merchant: pick(DEMO_MERCHANTS.cash),
        amount: cents({ min: 1500, max: 12000 }),
        accountKey: 'cash',
        paymentType: PAYMENT_TYPES.cash,
        window: 'midday',
      });
    }
  };

  let monthIndex = 0;
  let cursor = startDate;

  while (cursor <= generatedAt) {
    const context: MonthContext = {
      monthDate: cursor,
      monthIndex,
      monthStart: startOfMonth(cursor),
      monthEnd: endOfMonth(cursor),
      calendarMonth: cursor.getMonth(),
    };

    emitMonthlyIncome(context);
    emitRecurringBills(context);
    emitSubscriptionCharges(context);
    emitTransfers(context);
    emitDailySpending(context);
    emitTravelCardSpending(context);
    emitCashSpending(context);

    monthIndex += 1;
    cursor = addDays(context.monthEnd, 1);
  }

  // Reset faker to random mode to avoid polluting global state (e.g. in e2e tests)
  faker.seed();

  return { generatedAt, transactions, splits, refunds, groups, subscriptionPayments };
}
