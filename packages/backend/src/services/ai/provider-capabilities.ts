import { AI_PROVIDER, isAiCliProvider } from '@bt/shared/types';

/**
 * Custom OpenAI-compatible endpoints reject the `file` part a PDF becomes, and the CLI providers take
 * images only, so a PDF reaches those as extracted text or rendered page images.
 */
export function providerTakesPdfFileParts({ provider }: { provider: AI_PROVIDER }): boolean {
  return provider !== AI_PROVIDER.custom && !isAiCliProvider({ provider });
}
