import { createHash } from 'node:crypto';

/**
 * The query parameters known to carry a credential, as a whole name with every separator and case
 * left out (`api_key`, `API-Key` and `apiKey` all read `apikey`). Rotating one's value does not
 * change which rates the URL returns. The list is explicit on purpose: a name that merely ends in
 * `token` or `key` can pick the asset (`sellToken`, `srcToken`), and its value must tell histories apart.
 */
const CREDENTIAL_PARAMS: ReadonlySet<string> = new Set([
  'apikey',
  'apitoken',
  'apisecret',
  'appkey',
  'appid',
  'appsecret',
  'key',
  'token',
  'secret',
  'accesskey',
  'accesstoken',
  'accesssecret',
  'authtoken',
  'bearertoken',
  'refreshtoken',
  'idtoken',
  'sessiontoken',
  'sessionid',
  'session',
  'secretkey',
  'privatekey',
  'subscriptionkey',
  'clientsecret',
  'sig',
  'signature',
  'auth',
  'authorization',
  'password',
  'passwd',
  'pwd',
  'pass',
  'credential',
  'credentials',
]);

const isCredentialParam = ({ name }: { name: string }): boolean => {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // An undecodable name is compared as written.
  }

  return CREDENTIAL_PARAMS.has(decoded.toLowerCase().replaceAll(/[^a-z0-9]/g, ''));
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
