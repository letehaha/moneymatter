import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FilePart,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { UnsupportedFunctionalityError } from 'ai';

export type CliPromptPart = { type: 'text'; text: string } | { type: 'image'; mediaType: string; base64: string };

export interface CliPrompt {
  /** System messages joined; empty when the call has none. */
  system: string;
  parts: CliPromptPart[];
}

const DEFAULT_IMAGE_MEDIA_TYPE = 'image/png';

function toBase64({ data }: { data: LanguageModelV3FilePart['data'] }): string {
  if (data instanceof URL) {
    throw new UnsupportedFunctionalityError({ functionality: 'file URLs (attach the file bytes instead)' });
  }

  if (typeof data === 'string') return data;

  return Buffer.from(data).toString('base64');
}

function toImagePart({ part }: { part: LanguageModelV3FilePart }): CliPromptPart {
  if (!part.mediaType.startsWith('image/')) {
    throw new UnsupportedFunctionalityError({
      functionality: `${part.mediaType} file parts (only images are supported)`,
    });
  }

  return {
    type: 'image',
    mediaType: part.mediaType === 'image/*' ? DEFAULT_IMAGE_MEDIA_TYPE : part.mediaType,
    base64: toBase64({ data: part.data }),
  };
}

/**
 * Flattens an AI SDK prompt into one system string and one ordered list of text and image parts.
 * The CLIs run a single turn, so prior assistant turns become labelled text. Anything the CLIs
 * cannot take (tools, tool results, non-image files, file URLs) is refused before a process starts.
 */
export function extractCliPrompt({ options }: { options: LanguageModelV3CallOptions }): CliPrompt {
  if (options.tools && options.tools.length > 0) {
    throw new UnsupportedFunctionalityError({ functionality: 'tools (the CLI providers run without tools)' });
  }

  const system: string[] = [];
  const conversation = options.prompt.filter((message) => message.role !== 'system');
  const label = conversation.length > 1;
  const parts: CliPromptPart[] = [];

  for (const message of options.prompt) {
    if (message.role === 'system') {
      system.push(message.content);
      continue;
    }

    if (message.role === 'tool') {
      throw new UnsupportedFunctionalityError({ functionality: 'tool results' });
    }

    if (label) parts.push({ type: 'text', text: `[${message.role}]` });

    for (const part of message.content) {
      if (part.type === 'text') {
        parts.push({ type: 'text', text: part.text });
      } else if (part.type === 'file') {
        parts.push(toImagePart({ part }));
      } else if (part.type !== 'reasoning') {
        throw new UnsupportedFunctionalityError({ functionality: `${part.type} content` });
      }
    }
  }

  return { system: system.join('\n\n'), parts };
}

export function buildUsage({
  inputTotal,
  inputNoCache,
  cacheRead,
  cacheWrite,
  outputTotal,
  reasoning,
  raw,
}: {
  inputTotal: number | undefined;
  inputNoCache: number | undefined;
  cacheRead: number | undefined;
  cacheWrite: number | undefined;
  outputTotal: number | undefined;
  reasoning: number | undefined;
  raw: LanguageModelV3Usage['raw'];
}): LanguageModelV3Usage {
  return {
    inputTokens: { total: inputTotal, noCache: inputNoCache, cacheRead, cacheWrite },
    outputTokens: {
      total: outputTotal,
      text: outputTotal !== undefined && reasoning !== undefined ? outputTotal - reasoning : undefined,
      reasoning,
    },
    raw,
  };
}

export const asCount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** The CLIs answer once, so streaming is the finished answer delivered as a single text chunk. */
export async function generateResultToStream({
  generate,
}: {
  generate: () => PromiseLike<LanguageModelV3GenerateResult>;
}): Promise<LanguageModelV3StreamResult> {
  const result = await generate();

  const stream = new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: result.warnings });

      for (const content of result.content) {
        if (content.type === 'text') {
          controller.enqueue({ type: 'text-start', id: 'text-0' });
          controller.enqueue({ type: 'text-delta', id: 'text-0', delta: content.text });
          controller.enqueue({ type: 'text-end', id: 'text-0' });
        }
      }

      controller.enqueue({ type: 'finish', usage: result.usage, finishReason: result.finishReason });
      controller.close();
    },
  });

  return { stream, request: result.request, response: { headers: result.response?.headers } };
}
