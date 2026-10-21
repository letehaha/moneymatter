import isPlainObject from 'lodash/isPlainObject';

/**
 * An HTTP rate source's request headers are secrets that never travel in an archive (the encrypted
 * values are not even dumped, see `UsersCurrencies`); the names go too, so a restored source does
 * not claim headers it cannot send. The user enters them again.
 */
export function withoutHeaderNames({ config }: { config: unknown }): unknown {
  return isPlainObject(config) && 'headerNames' in (config as object)
    ? { ...(config as Record<string, unknown>), headerNames: [] }
    : config;
}
