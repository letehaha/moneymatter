export type Tx = { name: string; category: string; amount: number; color: string; income?: boolean; card?: boolean };

export const TX: Record<string, Tx> = {
  coffee: { name: 'Corner Coffee', category: 'Bar, cafe', amount: 6.5, color: '#e74c3c' },
  invoice: { name: 'Client invoice', category: 'Wage, invoices', amount: 640, color: '#f1c40f', income: true },
  groceries: { name: 'Green Market', category: 'Groceries', amount: 84.2, color: '#e74c3c', card: true },
  netflix: { name: 'Netflix', category: 'TV, Streaming', amount: 15.99, color: '#2ecc71' },
  metro: { name: 'Metro Transit', category: 'Public transport', amount: 2.9, color: '#95a5a6' },
  fuel: { name: 'City Fuel', category: 'Fuel', amount: 41.3, color: '#95a5a6', card: true },
  interest: {
    name: 'Savings interest',
    category: 'Interests, dividends',
    amount: 18.42,
    color: '#f1c40f',
    income: true,
  },
  lunch: { name: 'Chipotle', category: 'Restaurant, fast-food', amount: 13.85, color: '#e74c3c' },
};
