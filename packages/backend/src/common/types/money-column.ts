import { MONEY_COLUMN_PRECISION, MONEY_COLUMN_SCALE } from '@common/lib/money-columns';
import { DataType, addAttribute } from 'sequelize-typescript';

import { Money } from './money';

// ---------------------------------------------------------------------------
// @MoneyField property decorator
// ---------------------------------------------------------------------------

/**
 * Registers a monetary model attribute: a DECIMAL column plus attribute-level get/set closures
 * that convert to/from `Money`. The attribute name and DECIMAL scale are derived from the
 * decorated property, so neither can drift from the declaration.
 *
 * The property MUST use `declare` — it exists only at the type level, while
 * reads/writes go through the accessor Sequelize installs on the prototype for
 * every attribute. A real class field would shadow that accessor.
 *
 * The setter accepts `Money` or a raw decimal string/number, stored as given up to the column
 * scale. Rounding to a currency's own decimals happens before the value reaches the model (see
 * `roundToCurrency` / `roundMoneyValues` in `@common/lib/currency-precision`), because the
 * decimals depend on a currency the attribute setter cannot see.
 *
 * Defaults to the transactional money shape, `MONEY_COLUMN_PRECISION`/`MONEY_COLUMN_SCALE`.
 *
 * @example
 * @MoneyField({ allowNull: true })
 * declare grossAmount: Money | null;
 */
// `precision` and `scale` MUST match the real migration column type — nothing at compile time
// links the two, so a mismatch silently changes stored values.
export function MoneyField(opts: MoneyColumnOptions = {}): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const key = String(propertyKey);
    const column = buildColumnConfig(opts);
    const scale = opts.scale ?? MONEY_COLUMN_SCALE;

    addAttribute(target, key, {
      ...column,
      get(this: ModelDataAccess): Money {
        return moneyGetDecimal(this, key);
      },
      set(this: ModelDataAccess, val: Money | string | number | null): void {
        moneySetDecimal({ model: this, field: key, val, scale });
      },
    });
  };
}

// ---------------------------------------------------------------------------
// Column config helper (type + allowNull + defaultValue only, NO get/set)
// ---------------------------------------------------------------------------

function buildColumnConfig(opts: MoneyColumnOptions): MoneyColumnConfig {
  // When the column is nullable AND the caller did not explicitly supply a
  // defaultValue, default to `null` instead of `0`/`'0'`. Storing 0 for a
  // semantically-absent value loses the distinction between "no value set" and
  // "value is zero" and breaks `valueAnchor ?? fallback` patterns downstream.
  const nullableNoDefault = opts.allowNull === true && opts.defaultValue === undefined;

  const { precision = MONEY_COLUMN_PRECISION, scale = MONEY_COLUMN_SCALE } = opts;
  return {
    type: DataType.DECIMAL(precision, scale),
    allowNull: opts.allowNull ?? false,
    defaultValue: nullableNoDefault ? null : (opts.defaultValue ?? '0'),
  };
}

// ---------------------------------------------------------------------------
// Raw SQL values
// ---------------------------------------------------------------------------

/**
 * Decimal string for a money column in raw SQL (`literal`, `query` replacements, bulk inserts).
 * Raw SQL bypasses the `@MoneyField` setters, so this formats the value exactly as they store it.
 * It does not round to a currency: the caller rounds the value first, like any other write.
 */
export function toMoneyColumnValue({ money }: { money: Money }): string {
  return money.toDecimalString(MONEY_COLUMN_SCALE);
}

// ---------------------------------------------------------------------------
// Value conversion helpers used by the @MoneyField accessors
// ---------------------------------------------------------------------------

interface ModelDataAccess {
  getDataValue(key: string): unknown;
  setDataValue(key: string, value: unknown): void;
}

/** Getter helper for DECIMAL columns → returns Money */
function moneyGetDecimal(model: ModelDataAccess, field: string): Money {
  const raw = model.getDataValue(field);
  if (raw === null || raw === undefined) return null as unknown as Money;
  // Pass through non-primitive values (e.g. Sequelize Literals from Model.update())
  if (typeof raw !== 'number' && typeof raw !== 'string') return raw as unknown as Money;
  return Money.fromDecimal(raw as string | number);
}

/** Setter helper for DECIMAL columns ← accepts Money or raw value */
function moneySetDecimal({
  model,
  field,
  val,
  scale,
}: {
  model: ModelDataAccess;
  field: string;
  val: Money | string | number | null;
  scale: number;
}): void {
  // Raw values (null, decimal strings/numbers, Sequelize Literals) pass through unchanged
  model.setDataValue(field, Money.isMoney(val) ? val.toDecimalString(scale) : val);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MoneyColumnOptions {
  precision?: number;
  scale?: number;
  allowNull?: boolean;
  defaultValue?: number | string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MoneyColumnConfig = Record<string, any>;
