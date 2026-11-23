import { AUTOMATION_LIMITS } from '@bt/shared/types';
import { actionsSchema, conditionsSchema } from '@services/transaction-automations/zod-schemas';

export const automationConditionsInput = conditionsSchema.describe(
  [
    'Condition tree: { match: "all" | "any", items: [...] }. 1-10 items, at most one transactionType item.',
    'Item shapes by field:',
    '- note | merchant (merchant is the bank-provided merchant/description text): { field, operator, value }.',
    '  operator: contains_any | not_contains_any | starts_with_any | ends_with_any | equals_any | is_empty.',
    '  value: 1-20 case-insensitive keywords, max 64 chars each; required unless operator is is_empty.',
    '  Example: { "field": "merchant", "operator": "contains_any", "value": ["uber", "bolt"] }',
    '- payee | account | accountGroup | bankConnection: { field, operator, value }. operator: in | not_in.',
    '  value: 1-20 UUIDs of that entity, all owned by the user.',
    '  Example: { "field": "account", "operator": "in", "value": ["<accountId>"] }',
    '- amount: { field, operator, value: { min?, max? }, currency }. operator: gte | lte | between | equals.',
    '  gte and equals take min only, lte takes max only, between takes both. Bounds are decimals (e.g. 12.50).',
    '  currency: { "mode": "transaction" } compares in the currency of the transaction itself,',
    '  { "mode": "base" } in the user base currency, { "mode": "specific", "code": "USD" } in a fixed currency.',
    '  Example: { "field": "amount", "operator": "gte", "value": { "min": 100 }, "currency": { "mode": "base" } }',
    '- transactionType: { "field": "transactionType", "operator": "equals", "value": "income" | "expense" }',
    '- dayOfMonth: { "field": "dayOfMonth", "operator": "between", "value": { "min": 1, "max": 31 } }',
  ].join('\n'),
);

export const automationActionsInput = actionsSchema.describe(
  [
    `Actions applied when the conditions match. 1-${AUTOMATION_LIMITS.maxActions} actions, each type at most once.`,
    '- { "type": "set_category", "categoryId": "<uuid>" }',
    '- { "type": "add_tags", "tagIds": ["<uuid>"] } with 1-20 tag ids',
    '- { "type": "set_payee", "payeeId": "<uuid>" }',
    '- { "type": "set_note", "mode": "replace" | "append" | "prepend", "value": "<text, max 200 chars>" }',
    '- { "type": "exclude_from_stats" } hides the transaction from stats',
    'Every referenced category, tag, and payee must belong to the user, otherwise the call is rejected.',
  ].join('\n'),
);
