declare global {
  namespace jest {
    interface Matchers<R> {
      toBeAnythingOrNull(): R;
      toBeWithinRange(target: number, range: number): R;
      toBeNumericEqual(expected: number | string): R;
      toBeAfter(date: Date): R;
      toBeBefore(date: Date): R;
      /**
       * Custom matcher for ref values (refAmount, refInitialBalance, refCurrentBalance, etc.)
       * Rounds the expected value half-even to 2 decimals and passes within one hundredth.
       * @param expected - The expected decimal value (rounded half-even to 2 decimals)
       */
      toEqualRefValue(expected: number): R;
    }
    interface JestMatchers<T = unknown> {
      toBeAnythingOrNull(): T;
      toBeWithinRange(target: number, range: number): T;
      toBeNumericEqual(expected: number | string): T;
      toBeAfter(date: Date): T;
      toBeBefore(date: Date): T;
      /**
       * Custom matcher for ref values (refAmount, refInitialBalance, refCurrentBalance, etc.)
       * Rounds the expected value half-even to 2 decimals and passes within one hundredth.
       * @param expected - The expected decimal value (rounded half-even to 2 decimals)
       */
      toEqualRefValue(expected: number): T;
    }
  }
}

declare module '@jest/expect' {
  interface AsymmetricMatchers {
    toBeAnythingOrNull(): unknown | null;
    toBeWithinRange(target: number, range: number): number;
    toBeNumericEqual(expected: number | string): unknown;
    toEqualRefValue(expected: number): number;
  }
  interface Matchers<R> {
    toBeAnythingOrNull(): R;
    toBeWithinRange(target: number, range: number): R;
    toBeNumericEqual(expected: number | string): R;
    toBeAfter(date: Date): R;
    toBeBefore(date: Date): R;
    toEqualRefValue(expected: number): R;
  }
}

// oxlint-disable-next-line unicorn/require-module-specifiers -- needed to make this a module for `declare global`
export {};
