import { createHash } from 'node:crypto';

/**
 * A query parameter whose name says it carries a credential (`apikey`, `access_token`, `appid`...).
 * Rotating its value does not change which rates the URL returns.
 */
const CREDENTIAL_PARAM_PATTERN =
  /(?:key|token|secret|auth|password|passwd|pwd|signature|credential|session|appid)$|^(?:sig|k|pass|access)$/;

const isCredentialParam = ({ name }: { name: string }): boolean => {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // An undecodable name is compared as written.
  }

  return CREDENTIAL_PARAM_PATTERN.test(decoded.toLowerCase().replaceAll(/[^a-z0-9]/g, ''));
};

/** The query pairs of a template with the value of every credential parameter left out, in a fixed order. */
const normalizeQuery = ({ query }: { query: string }): string[] =>
  query
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const separator = pair.indexOf('=');
      const name = separator === -1 ? pair : pair.slice(0, separator);

      return isCredentialParam({ name }) ? `${name}=` : pair;
    })
    .toSorted();

/**
 * Identifies which rates an HTTP source returns, so the rates stored under it can be told apart from
 * the ones another config would return. The request headers are left out (they authenticate, they do
 * not select data), and so are the values of credential-named query parameters, so an API key
 * rotated in the URL keeps the history. Any other change of URL, path or quote starts a new history.
 * Holds no secret: the hash is of the URL without credential values.
 */
export const httpHistoryFingerprint = ({
  urlTemplate,
  jsonPath,
  quoteCurrency,
}: {
  urlTemplate: string;
  jsonPath: string;
  quoteCurrency: string;
}): string => {
  const withoutFragment = urlTemplate.split('#', 1)[0]!;
  const queryStart = withoutFragment.indexOf('?');
  const location = queryStart === -1 ? withoutFragment : withoutFragment.slice(0, queryStart);
  const query = queryStart === -1 ? '' : withoutFragment.slice(queryStart + 1);

  return createHash('sha256')
    .update(JSON.stringify([location, normalizeQuery({ query }), jsonPath, quoteCurrency]))
    .digest('hex');
};
