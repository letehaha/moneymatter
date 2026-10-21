export const amount = (value: number | string): boolean => Number.isFinite(value) && Number(value) > 0;
export const maxDecimalPoints =
  (points: number | string) =>
  (value: number | string): boolean => {
    const number = parseFloat(String(value));

    if (!Number.isFinite(number)) return false;

    // String() gives the shortest accurate decimal representation (e.g. "1.12"),
    // avoiding the IEEE 754 artifacts that toFixed(20) introduces.
    const str = String(number);
    const eIndex = str.indexOf('e');

    // Handle scientific notation (e.g. 1e-7 → 7 decimal places)
    if (eIndex !== -1) {
      const mantissaDecimals = str.substring(0, eIndex).split('.')[1]?.length ?? 0;
      const exponent = parseInt(str.substring(eIndex + 1), 10);
      return Math.max(0, mantissaDecimals - exponent) <= Number(points);
    }

    const parts = str.split('.');
    if (parts.length < 2) return true;
    return parts[1]!.length <= Number(points);
  };

export const requiredToBeTrue = (value: unknown): boolean => value === true;

export * from '@vuelidate/validators';
