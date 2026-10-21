import { createController } from '@controllers/helpers/controller-factory';
import { RequestShape } from '@middlewares/validations';
import { z } from 'zod';

/**
 * Request shape shared by the Wallet and YNAB parse endpoints: a single
 * non-empty `fileContent` string. CSV passes its own schema (it also accepts a
 * `delimiter`).
 */
export const fileContentParseSchema = z.object({
  body: z.object({
    fileContent: z.string().min(1, 'File content cannot be empty'),
  }),
});

type ParseBody<S extends z.ZodType> = z.infer<S> extends { body: infer B } ? B : never;

/**
 * Builds a parse-stage controller: validate the request, run the parser over
 * the validated body (and the caller's id, for parsers that recognise the
 * user's own custom currencies), and return the parsed result in the response
 * envelope. Wallet and YNAB nest the value under `{ result }` (the default);
 * CSV returns it flat, so `wrap` is configurable.
 */
export function createParseController<S extends z.ZodType<RequestShape>, R>({
  schema,
  parse,
  wrap = (result: R) => ({ result }),
}: {
  schema: S;
  parse: (body: ParseBody<S>, context: { userId: number }) => R | Promise<R>;
  wrap?: (result: R) => unknown;
}) {
  return createController(schema, async ({ body, user }) => {
    const result = await parse(body as ParseBody<S>, { userId: user.id });
    return { data: wrap(result) };
  });
}
