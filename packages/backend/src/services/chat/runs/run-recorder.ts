import type { ChatMessagePart, ChatRunEvent, ChatUsage } from '@bt/shared/types';

interface RunRecorder {
  apply: (event: ChatRunEvent) => void;
  /** A copy of the parts so far, so a snapshot does not change as the run goes on. */
  parts: () => ChatMessagePart[];
  usage: () => ChatUsage;
  /** The text of the answer, or null when the run wrote none (or retracted it all). */
  plainText: () => string | null;
}

/**
 * Builds the stored message from the run's own events, so what is persisted is what the stream showed:
 * a part appears when it starts, a text part grows with its deltas, and a retracted text part is gone.
 */
export function createRunRecorder(): RunRecorder {
  const parts: ChatMessagePart[] = [];
  const usage: ChatUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

  const findPart = ({ id }: { id: string }) => parts.find((part) => part.id === id);

  return {
    apply: (event) => {
      switch (event.type) {
        case 'part.started':
          parts.push(structuredClone(event.part));
          break;
        case 'text.delta': {
          const part = findPart({ id: event.partId });
          if (part?.type === 'text') part.text += event.delta;
          break;
        }
        case 'text.retracted': {
          const retracted = new Set(event.partIds);
          for (let index = parts.length - 1; index >= 0; index--) {
            if (retracted.has(parts[index]!.id)) parts.splice(index, 1);
          }
          break;
        }
        case 'part.updated': {
          const part = findPart({ id: event.partId });
          if (part) Object.assign(part, structuredClone(event.patch));
          break;
        }
        case 'usage':
          usage.inputTokens += event.inputTokens;
          usage.outputTokens += event.outputTokens;
          usage.cachedInputTokens += event.cachedInputTokens;
          break;
        default:
          break;
      }
    },

    parts: () => structuredClone(parts),

    usage: () => ({ ...usage }),

    plainText: () => {
      const text = parts
        .flatMap((part) => (part.type === 'text' && part.text.trim() ? [part.text.trim()] : []))
        .join('\n\n');

      return text || null;
    },
  };
}
