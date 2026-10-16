import { DataType, addAttribute } from 'sequelize-typescript';

import { Money } from './money';

// ---------------------------------------------------------------------------
// @MoneyField property decorator
// ---------------------------------------------------------------------------

/**
 * Registers a monetary model attribute: column type (BIGINT cents or DECIMAL)
 * plus attribute-level get/set closures that convert to/from `Money`. The
 * attribute name and DECIMAL scale are derived from the decorated property, so
 * neither can drift from the declaration.
 *
 * The property MUST use `declare` — it exists only at the type level, while
 * reads/writes go through the accessor Sequelize installs on the prototype for
 * every attribute. A real class field would shadow that accessor.
 *
 * Value contracts (same as the underlying setters):
 * - cents: accepts `Money` or a raw number of CENTS
 * - decimal: accepts `Money` or a raw decimal string/number; `roundOnWrite` rounds it half-up first
 *
 * @example
 * // BIGINT column storing cents:
 * @MoneyField({ storage: 'cents' })
 * declare amount: Money;
 *
 * // DECIMAL column (investments), nullable:
 * @MoneyField({ storage: 'decimal', precision: 20, scale: 10, allowNull: true })
 * declare grossAmount: Money | null;
 */
// `storage` MUST match the real migration column type (BIGINT for 'cents', DECIMAL for 'decimal') —
// nothing at compile time links the two, so a mismatch silently corrupts stored values.
export function MoneyField(opts: MoneyColumnCentsOptions): PropertyDecorator;
export function MoneyField(opts: MoneyColumnDecimalOptions): PropertyDecorator;
export function MoneyField(opts: MoneyColumnOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const key = String(propertyKey);
    const column = buildColumnConfig(opts);

    const accessors =
      opts.storage === 'cents'
        ? {
            get(this: ModelDataAccess): Money {
              return moneyGetCents(this, key);
            },
            set(this: ModelDataAccess, val: Money | number | null): void {
              moneySetCents(this, key, val);
            },
          }
        : (() => {
            const scale = opts.scale ?? DEFAULT_DECIMAL_SCALE;
            const { roundOnWrite } = opts;
            return {
              get(this: ModelDataAccess): Money {
                return moneyGetDecimal(this, key);
              },
              set(this: ModelDataAccess, val: Money | string | number | null): void {
                moneySetDecimal({ model: this, field: key, val, scale, roundOnWrite });
              },
            };
          })();

    addAttribute(target, key, { ...column, ...accessors });
  };
}

// ---------------------------------------------------------------------------
// Column config helper (type + allowNull + defaultValue only, NO get/set)
// ---------------------------------------------------------------------------

const DEFAULT_DECIMAL_PRECISION = 20;
const DEFAULT_DECIMAL_SCALE = 10;

function buildColumnConfig(opts: MoneyColumnOptions): MoneyColumnConfig {
  // When the column is nullable AND the caller did not explicitly supply a
  // defaultValue, default to `null` instead of `0`/`'0'`. Storing 0 for a
  // semantically-absent value loses the distinction between "no value set" and
  // "value is zero" and breaks `valueAnchor ?? fallback` patterns downstream.
  const nullableNoDefault = opts.allowNull === true && opts.defaultValue === undefined;

  if (opts.storage === 'cents') {
    // BIGINT (not INTEGER) so that low-denomination currencies (IDR, VND, etc.)
    // or any large balance can exceed the 32-bit INTEGER ceiling without overflow.
    return {
      type: DataType.BIGINT,
      allowNull: opts.allowNull ?? false,
      defaultValue: nullableNoDefault ? null : (opts.defaultValue ?? 0),
    };
  }

  // storage === 'decimal'
  const { precision = DEFAULT_DECIMAL_PRECISION, scale = DEFAULT_DECIMAL_SCALE } = opts;
  return {
    type: DataType.DECIMAL(precision, scale),
    allowNull: opts.allowNull ?? false,
    defaultValue: nullableNoDefault ? null : (opts.defaultValue ?? '0'),
  };
}

// ---------------------------------------------------------------------------
// Value conversion helpers used by the @MoneyField accessors
// ---------------------------------------------------------------------------

interface ModelDataAccess {
  getDataValue(key: string): unknown;
  setDataValue(key: string, value: unknown): void;
}

/** Getter helper for BIGINT (cents) columns → returns Money */
function moneyGetCents(model: ModelDataAccess, field: string): Money {
  const raw = model.getDataValue(field);
  if (raw === null || raw === undefined) return null as unknown as Money;
  // Pass through non-numbers (e.g. Sequelize Literals from Model.update())
  if (typeof raw !== 'number') return raw as unknown as Money;
  return Money.fromCents(raw as number);
}

/** Setter helper for BIGINT (cents) columns ← accepts Money or raw number */
function moneySetCents(model: ModelDataAccess, field: string, val: Money | number | null): void {
  if (val === null) {
    model.setDataValue(field, null);
  } else if (Money.isMoney(val)) {
    model.setDataValue(field, val.toCents());
  } else {
    // Backward compatibility: accept raw numbers
    model.setDataValue(field, val);
  }
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
  roundOnWrite,
}: {
  model: ModelDataAccess;
  field: string;
  val: Money | string | number | null;
  scale: number;
  roundOnWrite: number | undefined;
}): void {
  if (val === null) {
    model.setDataValue(field, null);
  } else if (Money.isMoney(val)) {
    const rounded = roundOnWrite === undefined ? val : val.round(roundOnWrite);
    model.setDataValue(field, rounded.toDecimalString(scale));
  } else if (roundOnWrite !== undefined && (typeof val === 'number' || typeof val === 'string')) {
    model.setDataValue(field, Money.fromDecimal(val).round(roundOnWrite).toDecimalString(scale));
  } else {
    // Raw values (decimal strings/numbers, Sequelize Literals) pass through unchanged
    model.setDataValue(field, val);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MoneyColumnBaseOptions {
  allowNull?: boolean;
  defaultValue?: number | string;
}

interface MoneyColumnCentsOptions extends MoneyColumnBaseOptions {
  storage: 'cents';
}

interface MoneyColumnDecimalOptions extends MoneyColumnBaseOptions {
  storage: 'decimal';
  precision?: number;
  scale?: number;
  /**
   * Rounds every written value half-up to this many decimals before it is stored. A column
   * holding amounts in more than one currency uses it as a fixed 2-decimal ceiling until the
   * write paths round per currency.
   */
  roundOnWrite?: number;
}

type MoneyColumnOptions = MoneyColumnCentsOptions | MoneyColumnDecimalOptions;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MoneyColumnConfig = Record<string, any>;
