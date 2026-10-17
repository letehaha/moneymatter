import { HttpResponse, delay, http } from 'msw';

/** Every mocked push service endpoint lives on `*.push.example.test`, which the suite's allowlist admits. */
export const PUSH_ENDPOINT_REGEX = /^https:\/\/[^/]+\.push\.example\.test\//;

/** How long a `/hold/` endpoint keeps a request open before it answers 500. */
export const PUSH_HOLD_MS = 500;

/**
 * The first path segment of an endpoint picks the mocked push service's answer:
 * - `ok` 201
 * - `gone` 410, `missing` 404
 * - `bad` 400, `bad-once` 400 for the first request and 201 afterwards
 * - `forbidden` 403
 * - `down` 500 every time, `flaky` 500 twice then 201, `rate` 429 once then 201
 * - `hold` records the request, waits `PUSH_HOLD_MS`, then answers 500
 */
export const PUSH_MOCK_KINDS = [
  'ok',
  'gone',
  'missing',
  'bad',
  'bad-once',
  'forbidden',
  'down',
  'flaky',
  'rate',
  'hold',
] as const;

export type PushMockKind = (typeof PUSH_MOCK_KINDS)[number];

export interface CapturedPushRequest {
  /** The full endpoint URL the request was sent to */
  endpoint: string;
  kind: PushMockKind;
  /** 1 for the first request to this endpoint, 2 for the second, ... */
  attempt: number;
  /** Lower-cased header names */
  headers: Record<string, string>;
  /** The encrypted body, as sent */
  body: Buffer;
}

const capturedRequests: CapturedPushRequest[] = [];
const attemptsByEndpoint = new Map<string, number>();

export const getCapturedPushRequests = ({ endpoint }: { endpoint?: string } = {}): CapturedPushRequest[] =>
  endpoint ? capturedRequests.filter((request) => request.endpoint === endpoint) : [...capturedRequests];

export const clearCapturedPushRequests = (): void => {
  capturedRequests.length = 0;
  attemptsByEndpoint.clear();
};

const created = () => new HttpResponse(null, { status: 201, headers: { Location: 'https://push.example.test/m/1' } });
const status = (code: number) => new HttpResponse(null, { status: code });

export const webPushHandlers = [
  http.post(PUSH_ENDPOINT_REGEX, async ({ request }) => {
    const kind = new URL(request.url).pathname.split('/')[1] as PushMockKind;
    const attempt = (attemptsByEndpoint.get(request.url) ?? 0) + 1;
    attemptsByEndpoint.set(request.url, attempt);

    capturedRequests.push({
      endpoint: request.url,
      kind,
      attempt,
      headers: Object.fromEntries(request.headers.entries()),
      body: Buffer.from(await request.arrayBuffer()),
    });

    switch (kind) {
      case 'gone':
        return status(410);
      case 'missing':
        return status(404);
      case 'bad':
        return status(400);
      case 'bad-once':
        return attempt === 1 ? status(400) : created();
      case 'forbidden':
        return status(403);
      case 'down':
        return status(500);
      case 'flaky':
        return attempt <= 2 ? status(500) : created();
      case 'rate':
        return attempt === 1 ? status(429) : created();
      case 'hold':
        await delay(PUSH_HOLD_MS);
        return status(500);
      default:
        return created();
    }
  }),
];
