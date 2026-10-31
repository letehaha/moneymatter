import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type { YaxiKey, YaxiReadService } from './types';

// YAXI rejects tickets valid for more than 15 minutes; one spare minute absorbs clock drift.
const TICKET_LIFETIME_SECONDS = 14 * 60;

const encodeSegment = ({ value }: { value: unknown }) => Buffer.from(JSON.stringify(value)).toString('base64url');

const signature = ({ signingInput, secret }: { signingInput: string; secret: string }) =>
  createHmac('sha256', Buffer.from(secret, 'base64')).update(signingInput).digest();

export const issueTicket = ({
  key,
  service,
  data = null,
}: {
  key: YaxiKey;
  service: YaxiReadService;
  data?: unknown;
}): { ticket: string; ticketId: string } => {
  const ticketId = randomUUID();
  const header = encodeSegment({ value: { alg: 'HS256', typ: 'JWT', kid: key.keyId } });
  const payload = encodeSegment({
    value: {
      data: { service, id: ticketId, data },
      exp: Math.floor(Date.now() / 1000) + TICKET_LIFETIME_SECONDS,
    },
  });
  const signingInput = `${header}.${payload}`;

  return {
    ticket: `${signingInput}.${signature({ signingInput, secret: key.secret }).toString('base64url')}`,
    ticketId,
  };
};

/** Returns the ticket ID a result JWT is bound to, or null when the JWT is not authentic. */
export const verifyResultJwt = ({ jwt, secret }: { jwt: string; secret: string }): { ticketId: string } | null => {
  const [header, payload, signed, ...rest] = jwt.split('.');
  if (!header || !payload || !signed || rest.length > 0) return null;

  const expected = signature({ signingInput: `${header}.${payload}`, secret });
  const actual = Buffer.from(signed, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const { alg } = JSON.parse(Buffer.from(header, 'base64url').toString());
    const { data, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (alg !== 'HS256' || typeof data?.ticketId !== 'string') return null;
    if (typeof exp === 'number' && exp * 1000 < Date.now()) return null;

    return { ticketId: data.ticketId };
  } catch {
    return null;
  }
};
