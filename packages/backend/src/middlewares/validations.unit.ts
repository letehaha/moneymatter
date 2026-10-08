import { API_ERROR_CODES } from '@bt/shared/types/api';
import { CustomResponse } from '@common/types';
import { describe, expect, it, jest } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { Request } from 'express';
import { z } from 'zod';

import { validateRequest } from './validations';

const schema = z.object({ body: z.object({ name: z.string().min(2) }) });

const makeRes = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};
const makeReq = (body: unknown) => ({ body, params: {}, query: {} }) as Request;
const asResponse = (res: ReturnType<typeof makeRes>) => res as unknown as CustomResponse;

describe('validateRequest', () => {
  it('returns the parsed value and writes nothing on success', () => {
    const res = makeRes();

    expect(validateRequest({ schema, req: makeReq({ name: 'ok' }), res: asResponse(res) })).toEqual({
      body: { name: 'ok' },
    });
    expect(res.json).not.toHaveBeenCalled();
  });

  it('writes the 422 envelope and returns undefined on a Zod failure', () => {
    const res = makeRes();

    expect(validateRequest({ schema, req: makeReq({ name: 'x' }), res: asResponse(res) })).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(ERROR_CODES.ValidationError);
    const payload = res.json.mock.calls[0]![0] as {
      response: { code: string; message: string; validationErrors: unknown[] };
    };
    expect(payload.response.code).toBe(API_ERROR_CODES.validationError);
    expect(payload.response.message).toMatch(/^body\.name: /);
    expect(payload.response.validationErrors).toHaveLength(1);
  });

  it('rethrows non-Zod errors instead of answering', () => {
    const throwing = z.object({}).transform(() => {
      throw new Error('boom');
    });
    const res = makeRes();

    expect(() => validateRequest({ schema: throwing, req: makeReq({}), res: asResponse(res) })).toThrow('boom');
    expect(res.json).not.toHaveBeenCalled();
  });
});
