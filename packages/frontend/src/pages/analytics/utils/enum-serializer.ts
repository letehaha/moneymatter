export const createEnumSerializer = <T extends string>({
  values,
  fallback,
}: {
  values: readonly T[];
  fallback: T;
}) => ({
  read: (raw: string): T => (values.includes(raw as T) ? (raw as T) : fallback),
  write: (value: T): string => value,
});
