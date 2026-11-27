export type PlanId = 'essential' | 'plus' | 'premium';

export type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  yearly: number;
  monthly: number;
  tag?: string;
  highlight?: boolean;
  planned?: boolean;
  lead?: number;
  features: string[];
};

export const PLANS: Plan[] = [
  {
    id: 'essential',
    name: 'Essential',
    tagline: 'Manual entry and everything that is local math.',
    yearly: 30,
    monthly: 5,
    features: [
      'Imports: CSV, OFX, YNAB, Wallet, MS Money',
      'Investments, loans, vehicles, venture',
      'AI features with your own API key',
      'Backup export and restore',
      'MCP server for AI agents',
      '2 household seats',
    ],
  },
  {
    id: 'plus',
    name: 'Plus',
    tagline: 'Everything around bring-your-own bank connections.',
    yearly: 55,
    monthly: 8,
    tag: 'Includes bank sync',
    highlight: true,
    lead: 1,
    features: [
      'Everything in Essential',
      'Bank sync: LunchFlow, SimpleFIN, Monobank, Akahu',
      'AI features on our key, no setup',
      'FIRE planner',
      '5 household seats',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    tagline: 'Bank connections we run for you.',
    planned: true,
    yearly: 80,
    monthly: 12,
    features: [
      'Everything in Plus',
      'Bank sync we run: no API keys, no provider subscription',
      '2 banks included (unlimited accounts), extra banks $2/mo',
      'Real-time security prices',
      'Higher AI usage cap',
      '10 household seats',
    ],
  },
];

export const GIFT_PLANS = PLANS.filter((plan) => !plan.planned);
