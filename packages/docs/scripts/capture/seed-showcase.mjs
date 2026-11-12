// A year of fictional history for the views that need one: goals, trackers, automations, investments,
// money flow and net worth. Dates are relative to the first run.
const CHECKING = 'Main Checking';
const HIGH_YIELD = 'High-Yield Savings';
const RAINY_DAY = 'Rainy Day Fund';
const HOME_FUND = 'Home Fund';
const PORTFOLIO = 'Brokerage';
const MONTHS = 12;
const DAY = 86_400_000;

const now = new Date();
const at = ({ monthsAgo = 0, day = 1, daysAgo }) =>
  daysAgo === undefined
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, day, 12))
    : new Date(Date.now() - daysAgo * DAY);
const ymd = (date) => date.toISOString().slice(0, 10);

let seed = 42;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return seed / 2 ** 31;
};
const between = ({ min, max }) => Math.round((min + random() * (max - min)) * 100) / 100;

const buildAutomations = ({ category, payee, account }) => [
  {
    name: 'Ride-hailing',
    conditions: { match: 'all', items: [{ field: 'merchant', operator: 'contains_any', value: ['uber', 'lyft'] }] },
    actions: [{ type: 'set_category', categoryId: category('taxi') }],
  },
  {
    name: 'Monthly rent',
    conditions: {
      match: 'all',
      items: [
        { field: 'note', operator: 'contains_any', value: ['RENT'] },
        { field: 'transactionType', operator: 'equals', value: 'expense' },
        { field: 'amount', operator: 'equals', value: { min: 1200 }, currency: { mode: 'transaction' } },
        { field: 'account', operator: 'in', value: [account(CHECKING)] },
      ],
    },
    actions: [
      { type: 'set_category', categoryId: category('rent') },
      { type: 'set_payee', payeeId: payee('Landlord') },
    ],
  },
  {
    name: 'Streaming',
    conditions: {
      match: 'all',
      items: [{ field: 'merchant', operator: 'contains_any', value: ['netflix', 'spotify'] }],
    },
    actions: [{ type: 'set_category', categoryId: category('tv-streaming') }],
  },
  {
    name: 'Weekly groceries',
    conditions: {
      match: 'all',
      items: [
        { field: 'merchant', operator: 'contains_any', value: ['safeway', 'trader joe', 'whole foods'] },
        { field: 'transactionType', operator: 'equals', value: 'expense' },
      ],
    },
    actions: [{ type: 'set_category', categoryId: category('groceries') }],
  },
  {
    name: 'Salary',
    conditions: {
      match: 'all',
      items: [
        { field: 'note', operator: 'contains_any', value: ['PAYROLL'] },
        { field: 'transactionType', operator: 'equals', value: 'income' },
        { field: 'dayOfMonth', operator: 'between', value: { min: 25, max: 31 } },
      ],
    },
    actions: [{ type: 'set_category', categoryId: category('wage-invoices') }],
  },
  {
    name: 'Morning coffee',
    conditions: {
      match: 'all',
      items: [
        { field: 'merchant', operator: 'contains_any', value: ['dunkin'] },
        { field: 'amount', operator: 'lte', value: { max: 15 }, currency: { mode: 'transaction' } },
      ],
    },
    actions: [
      { type: 'set_category', categoryId: category('bar-cafe') },
      { type: 'set_payee', payeeId: payee("Dunkin'") },
    ],
  },
];

// Rows without a category start as Other and run through the automations above, which counts their matches.
function monthOfTransactions({ monthsAgo }) {
  const rows = [
    { day: 3, amount: 1200, note: 'RENT payment' },
    { day: 28, amount: 5400, note: 'ACME CORP PAYROLL', income: true },
    { day: 8, amount: between({ min: 92, max: 138 }), note: 'City Power & Water', category: 'energy-utilities' },
    { day: 10, amount: 60, note: 'Fiber internet', category: 'internet' },
    { day: 14, amount: 35, note: 'Mobile plan', category: 'phone-cell-phone' },
    { day: 15, amount: 380, note: 'Estimated tax payment', category: 'taxes' },
    { day: 17, amount: 142, note: 'Renters & health insurance', category: 'insurances' },
    { day: 2, amount: 45, note: 'Gym membership', category: 'active-sport-fitness' },
    { day: 6, amount: 15.49, note: 'NETFLIX.COM' },
    { day: 9, amount: 11.99, note: 'SPOTIFY USA' },
  ];
  if (monthsAgo % 2 === 0 || monthsAgo % 5 === 1) {
    rows.push({
      day: 12,
      amount: between({ min: 1200, max: 2300 }),
      note: 'Client invoice',
      income: true,
      category: 'freelance',
    });
  }
  for (const day of [4, 11, 18, 25]) {
    rows.push({
      day,
      amount: between({ min: 68, max: 142 }),
      note: random() > 0.5 ? 'SAFEWAY #1432' : "TRADER JOE'S #552",
    });
  }
  for (const day of [7, 16, 23])
    rows.push({ day, amount: between({ min: 32, max: 88 }), note: 'Dinner out', category: 'restaurant' });
  for (const day of [5, 9, 13, 19, 22, 27])
    rows.push({ day, amount: between({ min: 4.2, max: 8.9 }), note: 'DUNKIN #332' });
  for (const day of [6, 20, 26]) rows.push({ day, amount: between({ min: 12, max: 34 }), note: 'UBER *TRIP' });
  rows.push({ day: 21, amount: between({ min: 45, max: 190 }), note: 'Clothing store', category: 'clothes-shoes' });
  if (monthsAgo % 3 === 0)
    rows.push({ day: 24, amount: between({ min: 60, max: 140 }), note: 'Pharmacy', category: 'drugstore-chemist' });
  if (monthsAgo % 4 === 2)
    rows.push({
      day: 19,
      amount: between({ min: 120, max: 320 }),
      note: 'Concert tickets',
      category: 'culture-sport-events',
    });
  return rows;
}

const LISBON_TRIP = [
  { daysAgo: 21, amount: 412, note: 'TAP Air Portugal', category: 'long-distance' },
  { daysAgo: 21, amount: 336, note: 'Return flight', category: 'long-distance' },
  { daysAgo: 20, amount: 640, note: 'Hotel Alfama', category: 'holiday-trips-hotels' },
  { daysAgo: 6, amount: 360, note: 'Apartment Bairro Alto', category: 'holiday-trips-hotels' },
  { daysAgo: 9, amount: 58, note: 'Time Out Market', category: 'restaurant' },
  { daysAgo: 8, amount: 96, note: 'Seafood dinner', category: 'restaurant' },
  { daysAgo: 7, amount: 112, note: 'Belém tasting menu', category: 'restaurant' },
  { daysAgo: 5, amount: 67, note: 'Pastéis & coffee', category: 'restaurant' },
  { daysAgo: 8, amount: 120, note: 'Sintra day tour', category: 'culture-sport-events' },
  { daysAgo: 6, amount: 96, note: 'Fado show', category: 'culture-sport-events' },
];

const KITCHEN = [
  { monthsAgo: 2, day: 5, amount: 2400, note: 'Cabinets deposit', category: 'maintenance-repairs' },
  { monthsAgo: 1, day: 2, amount: 1650, note: 'Countertop install', category: 'maintenance-repairs' },
  { monthsAgo: 1, day: 20, amount: 1320, note: 'Appliances', category: 'home-garden' },
  { monthsAgo: 0, day: 4, amount: 900, note: 'Tiling', category: 'maintenance-repairs' },
];

// prettier-ignore
const HOLDINGS = {
  VOO: [[16, 30], [9, 12], [3, -8]],
  VTI: [[15, 40], [6, 10]],
  AAPL: [[14, 35], [5, -10]],
  MSFT: [[13, 18], [4, 4]],
  NVDA: [[16, 60], [7, -20]],
  GOOGL: [[12, 30]],
  AMZN: [[11, 28]],
  META: [[10, 10]],
  QQQ: [[9, 12]],
  BND: [[14, 60], [5, 30]],
  V: [[8, 14]],
  KO: [[13, 45]],
  JNJ: [[12, 20]],
  TSLA: [[7, 8]],
  'BRK-B': [[15, 12]],
  JPM: [[11, 15]],
  LLY: [[9, 4]],
  WMT: [[10, 30]],
};

const found = ({ item, what }) => {
  if (!item) throw new Error(`not found: ${what}`);
  return item;
};

export async function seedShowcase({ call, log }) {
  const categories = await call({ path: '/categories' });
  const category = (key) => found({ item: categories.find((c) => c.key === key), what: `category ${key}` }).id;

  const payees = await call({ path: '/payees' });
  for (const body of [{ name: 'Landlord', logoInitials: 'L', logoColor: '#6366f1' }, { name: "Dunkin'" }]) {
    if (!payees.some((p) => p.name === body.name)) payees.push(await call({ method: 'POST', path: '/payees', body }));
  }
  const payee = (name) => found({ item: payees.find((p) => p.name === name), what: `payee ${name}` }).id;

  const accounts = await call({ path: '/accounts' });
  for (const [name, accountCategory, initialBalance] of [
    [CHECKING, 'current-account', 3200],
    [HIGH_YIELD, 'saving', 4000],
    [RAINY_DAY, 'saving', 4600],
    [HOME_FUND, 'saving', 14000],
  ]) {
    if (accounts.some((a) => a.name === name)) continue;
    accounts.push(
      await call({
        method: 'POST',
        path: '/accounts',
        body: { name, currencyCode: 'USD', initialBalance, accountCategory },
      }),
    );
  }
  const account = (name) => found({ item: accounts.find((a) => a.name === name), what: `account ${name}` }).id;

  const automations = await call({ path: '/automations' });
  for (const rule of buildAutomations({ category, payee, account })) {
    if (automations.some((a) => a.name === rule.name)) continue;
    await call({ method: 'POST', path: '/automations', body: rule });
    log(`automation "${rule.name}" created`);
  }

  const addTx = async ({ time, amount, note, income, category: key, accountName = CHECKING }) => {
    if (time > now) return null;
    const [tx] = await call({
      method: 'POST',
      path: '/transactions',
      body: {
        amount,
        note,
        time: time.toISOString(),
        accountId: account(accountName),
        categoryId: category(key ?? 'other'),
        applyAutomations: !key,
        transactionType: income ? 'income' : 'expense',
        paymentType: 'debitCard',
        transferNature: 'not_transfer',
      },
    });
    return tx;
  };
  const transfer = async ({ time, amount, to }) => {
    if (time > now) return;
    await call({
      method: 'POST',
      path: '/transactions',
      body: {
        amount,
        destinationAmount: amount,
        note: `Transfer to ${to}`,
        time: time.toISOString(),
        accountId: account(CHECKING),
        destinationAccountId: account(to),
        transactionType: 'expense',
        paymentType: 'bankTransfer',
        transferNature: 'transfer_between_user_accounts',
      },
    });
  };

  const lisbon = [];
  const kitchen = [];
  const freelance = [];
  const checking = accounts.find((a) => a.name === CHECKING);
  if (checking.currentBalance === checking.initialBalance) {
    for (let monthsAgo = MONTHS; monthsAgo >= 0; monthsAgo--) {
      for (const row of monthOfTransactions({ monthsAgo })) {
        const tx = await addTx({ ...row, time: at({ monthsAgo, day: row.day }) });
        if (tx && row.category === 'freelance' && monthsAgo <= 6) freelance.push(tx.id);
      }
      await transfer({ time: at({ monthsAgo, day: 26 }), amount: 500, to: HIGH_YIELD });
      await transfer({ time: at({ monthsAgo, day: 26 }), amount: 300, to: RAINY_DAY });
      await transfer({ time: at({ monthsAgo, day: 26 }), amount: 600, to: HOME_FUND });
      await addTx({
        time: at({ monthsAgo, day: 28 }),
        amount: between({ min: 28, max: 36 }),
        note: 'Interest',
        income: true,
        category: 'interests-dividends',
        accountName: HIGH_YIELD,
      });
    }
    for (const row of LISBON_TRIP) {
      const tx = await addTx({ ...row, time: at(row) });
      if (tx) lisbon.push(tx.id);
    }
    for (const row of KITCHEN) {
      const tx = await addTx({ ...row, time: at(row) });
      if (tx) kitchen.push(tx.id);
    }
    log(`${CHECKING}, ${HIGH_YIELD}, ${RAINY_DAY} and ${HOME_FUND} filled with ${MONTHS} months of history`);
  }

  const goals = await call({ path: '/goals' });
  const inMonths = (months) => ymd(at({ monthsAgo: -months, day: 1 }));
  for (const body of [
    {
      name: 'Trip to Japan',
      targetAmount: 6000,
      targetDate: inMonths(10),
      accounts: [{ accountId: account(HIGH_YIELD), sharePercent: 40 }],
      logoIcon: 'airplane-24-regular',
      logoColor: '#f59e0b',
    },
    {
      name: 'Car down payment',
      targetAmount: 12000,
      targetDate: inMonths(13),
      accounts: [{ accountId: account(HIGH_YIELD), sharePercent: 60 }],
      logoIcon: 'vehicle-car-24-regular',
      logoColor: '#0ea5e9',
    },
    {
      name: 'Emergency fund',
      targetAmount: 15000,
      accounts: [{ accountId: account(RAINY_DAY), sharePercent: 80 }],
      logoIcon: 'shield-checkmark-24-regular',
      logoColor: '#22c55e',
    },
    {
      name: 'New laptop',
      targetAmount: 1300,
      accounts: [{ accountId: account(RAINY_DAY), sharePercent: 20 }],
      logoIcon: 'laptop-24-regular',
      logoColor: '#6366f1',
    },
    {
      name: 'Home down payment',
      targetAmount: 40000,
      targetDate: inMonths(30),
      accounts: [{ accountId: account(HOME_FUND), sharePercent: 100 }],
      logoIcon: 'home-24-regular',
      logoColor: '#8b5cf6',
    },
  ]) {
    if (goals.some((g) => g.name === body.name)) continue;
    await call({ method: 'POST', path: '/goals', body: { currencyCode: 'USD', ...body } });
    log(`goal "${body.name}" created`);
  }

  const trackers = await call({ path: '/trackers' });
  const tracker = async ({
    lines = [],
    limitAmount = lines.reduce((sum, line) => sum + line.limitAmount, 0),
    transactionIds,
    startDate,
    endDate,
    ...body
  }) => {
    if (trackers.some((t) => t.name === body.name)) return;
    if (transactionIds && !transactionIds.length) {
      throw new Error(`tracker "${body.name}": no seeded transactions (history was skipped, reseed a fresh user)`);
    }
    const { id } = await call({
      method: 'POST',
      path: '/trackers',
      body: { ...body, limitAmount, startDate: startDate.toISOString(), endDate: endDate.toISOString() },
    });
    for (const [position, line] of lines.entries()) {
      await call({ method: 'POST', path: `/trackers/${id}/lines`, body: { ...line, position } });
    }
    if (transactionIds) await call({ method: 'POST', path: `/trackers/${id}/transactions`, body: { transactionIds } });
    log(`tracker "${body.name}" created`);
  };
  await tracker({
    name: 'Lisbon trip',
    startDate: at({ daysAgo: 22 }),
    endDate: at({ daysAgo: -9 }),
    logoIcon: 'airplane-24-regular',
    logoColor: '#f59e0b',
    lines: [
      { name: 'Flights', limitAmount: 900, categoryIds: [category('long-distance')] },
      { name: 'Hotels', limitAmount: 1300, categoryIds: [category('holiday-trips-hotels')] },
      { name: 'Food', limitAmount: 700, categoryIds: [category('restaurant')] },
      { name: 'Activities', limitAmount: 600, categoryIds: [category('culture-sport-events')] },
    ],
    transactionIds: lisbon,
  });
  await tracker({
    name: 'Kitchen renovation',
    startDate: at({ monthsAgo: 2, day: 3 }),
    endDate: at({ monthsAgo: -1, day: 17 }),
    limitAmount: 12000,
    logoIcon: 'home-24-regular',
    logoColor: '#0ea5e9',
    transactionIds: kitchen,
  });
  await tracker({
    name: 'Dining out',
    startDate: at({ day: 1 }),
    endDate: at({ monthsAgo: -1, day: 0 }),
    limitAmount: 600,
    categoryIds: [category('restaurant')],
    rulesEnabled: true,
    logoIcon: 'food-24-regular',
    logoColor: '#ef4444',
  });
  await tracker({
    name: 'Side project income',
    startDate: at({ monthsAgo: 6 }),
    endDate: new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1, 12)),
    limitAmount: 10000,
    limitKind: 'income_target',
    logoIcon: 'rocket-24-regular',
    logoColor: '#22c55e',
    transactionIds: freelance,
  });

  const portfolios = await call({ path: '/investments/portfolios' }).then((r) => r.data);
  const portfolioId =
    portfolios.find((p) => p.name === PORTFOLIO)?.id ??
    (await call({ method: 'POST', path: '/investments/portfolios', body: { name: PORTFOLIO } })).id;
  const held = await call({ path: `/investments/portfolios/${portfolioId}/holdings` });
  const securities = await call({ path: '/investments/securities' });
  const trades = [];
  for (const [symbol, orders] of Object.entries(HOLDINGS)) {
    const holding = held.find((h) => h.security.symbol === symbol);
    if (Number(holding?.quantity)) continue;
    // Several providers list the same ticker and the API returns them in no fixed order.
    const securityId =
      holding?.securityId ??
      found({
        item: securities
          .filter((s) => s.symbol === symbol && s.currencyCode === 'USD')
          .sort((a, b) => a.id.localeCompare(b.id))[0],
        what: `security ${symbol}`,
      }).id;
    if (!holding) await call({ method: 'POST', path: '/investments/holding', body: { portfolioId, securityId } });
    for (const [monthsAgo, quantity] of orders) {
      const from = at({ monthsAgo, day: 3 });
      const [price] = await call({
        path: `/investments/prices?securityId=${securityId}&from=${from.toISOString()}&to=${new Date(+from + 10 * DAY).toISOString()}`,
      });
      if (!price) throw new Error(`no ${symbol} price near ${ymd(from)}`);
      trades.push({
        securityId,
        category: quantity > 0 ? 'buy' : 'sell',
        date: price.date,
        quantity: Math.abs(quantity),
        price: Math.round(price.priceClose * 100) / 100,
      });
    }
  }
  if (trades.length) {
    // Funds every buy up front so the cash balance never dips below zero.
    const spent = trades.reduce((sum, t) => sum + (t.category === 'buy' ? t.quantity * t.price : 0), 0);
    await call({
      method: 'POST',
      path: `/investments/portfolios/${portfolioId}/cash-transaction`,
      body: {
        type: 'deposit',
        amount: String(Math.ceil(spent) + 1500),
        currencyCode: 'USD',
        date: ymd(at({ monthsAgo: 17 })),
      },
    });
    for (const { quantity, price, ...trade } of trades) {
      await call({
        method: 'POST',
        path: '/investments/transaction',
        body: { portfolioId, ...trade, quantity: String(quantity), price: price.toFixed(2), fees: '0' },
      });
    }
    log(`${PORTFOLIO}: ${trades.length} trades added`);
  }
}
