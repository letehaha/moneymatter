export const FINANCIAL_DATA_GUIDE_NAME = 'financial_data_guide';

export const FINANCIAL_DATA_GUIDE_DESCRIPTION =
  'Guidelines for understanding MoneyMatter financial data conventions. Read this before analyzing user data.';

export const FINANCIAL_DATA_GUIDE_CONTENT = `You are connected to MoneyMatter, a personal finance tracker. Here are important conventions:

**Currency Handling:**
- All monetary amounts are returned as decimals (e.g., 42.50 means $42.50)
- Fields prefixed with "ref" (refAmount, refBalance, etc.) are amounts converted to the user's base currency
- The user's base currency is available via get_user_profile
- When analyzing across accounts with different currencies, use ref* fields for accurate totals

**Transaction Types:**
- "income" — money received
- "expense" — money spent
- "transfer" — money moved between accounts (not income or expense)

**Data Relationships:**
- Transactions belong to one Account and one Category
- Transactions can have multiple Tags
- Trackers watch spending across one or more Categories or hand-picked Transactions; the period-based Budget plan is not available through these tools
- Categories can have parent-child hierarchy
- Savings goals are funded by a percentage share of one or more accounts' balances; an account's shares across non-archived goals never exceed 100%. They are separate from the Budget plan's envelope line goals

**Best Practices:**
- Always check the user's base currency first via get_user_profile
- Use search_transactions with date filters rather than requesting all data
- For spending analysis, prefer get_spending_by_categories or get_cash_flow over manually summing transactions
- Tracker limits and spending are always in the user's base currency
- Goal amounts (target, plannedMonthly, progress) are in the goal's own currencyCode, not the base currency`;
