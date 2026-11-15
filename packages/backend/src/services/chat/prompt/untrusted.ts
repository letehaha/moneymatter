import { randomBytes } from 'node:crypto';

export type UntrustedKind = 'toolResult' | 'attachment' | 'pageContext';

export interface UntrustedWrapper {
  /** 128 random bits as hex; only the opening and closing line of a block carry it. */
  nonce: string;
  wrap: (params: { kind: UntrustedKind; text: string }) => string;
}

/** An opening or closing marker in the style of ours, with any nonce or none. */
const FORGED_BOUNDARY = /<<<\s*(?:UNTRUSTED|END)\b/gi;

const escapeRegExp = ({ value }: { value: string }) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Wraps text the model must treat as data (an attachment, a tool result, page-context names) in a
 * block that only the run can close: the nonce is fresh per wrapper, and the content is stripped of
 * the nonce and of every marker that looks like a boundary first, so a document cannot forge the
 * end of its own block.
 */
export function createUntrustedWrapper({
  nonce = randomBytes(16).toString('hex'),
}: { nonce?: string } = {}): UntrustedWrapper {
  const nonceInContent = new RegExp(escapeRegExp({ value: nonce }), 'gi');

  return {
    nonce,
    wrap: ({ kind, text }) => {
      const clean = text.replace(nonceInContent, '').replace(FORGED_BOUNDARY, '[removed boundary]');
      return `<<<UNTRUSTED kind=${kind} nonce=${nonce}>>>\n${clean}\n<<<END ${nonce}>>>`;
    },
  };
}
