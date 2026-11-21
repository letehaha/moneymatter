const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_USER_ID = 2_147_483_647;

/** Splits on commas/whitespace; null when any token is neither a positive integer id nor an email. */
export const parseRecipients = (input: string): { userIds: number[]; emails: string[] } | null => {
  const userIds = new Set<number>();
  const emails = new Set<string>();

  for (const token of input.split(/[\s,;]+/).filter(Boolean)) {
    if (/^\d+$/.test(token) && Number(token) > 0 && Number(token) <= MAX_USER_ID) userIds.add(Number(token));
    else if (EMAIL_RE.test(token)) emails.add(token.toLowerCase());
    else return null;
  }

  return { userIds: [...userIds], emails: [...emails] };
};
