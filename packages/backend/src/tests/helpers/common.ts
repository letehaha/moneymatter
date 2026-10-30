import { API_ERROR_CODES, API_RESPONSE_STATUS } from '@bt/shared/types/api';
import { CustomResponse as ExpressCustomResponse } from '@common/types';
import { app } from '@root/app';
import { API_PREFIX } from '@root/config';
import request from 'supertest';

interface MakeRequestParams<T> {
  url: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  payload?: object | null;
  headers?: object;
  raw?: T;
  /** Poll an `inBackground` endpoint's job until it settles. Off to see the raw 202. */
  followBackgroundJob?: boolean;
}

export interface CustomResponse<T> extends ExpressCustomResponse {
  body: {
    code: API_ERROR_CODES;
    status: API_RESPONSE_STATUS;
    response: T;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const extractResponse = <T = any>(response: CustomResponse<T>) => response.body.response;

export type MakeRequestReturn<T, R extends boolean | undefined = false> = R extends true ? T : CustomResponse<T>;

export interface ErrorResponse {
  message: string;
  code: string;
  details?: Record<string, unknown>;
}

export type UtilizeReturnType<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends (...args: any[]) => any,
  R extends boolean | undefined,
> = Promise<MakeRequestReturn<Awaited<ReturnType<T>>, R>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function makeRequest<T = any, R extends boolean | undefined = false>({
  url,
  method,
  payload = null,
  headers = {},
  raw = false,
  followBackgroundJob: follow = true,
}: MakeRequestParams<R>): Promise<MakeRequestReturn<T, R>> {
  let tempUrl = url;

  // If not check for full existance, MSW will throw "Invariant Violation: Failed to write to a request stream: stream does not exist" error
  const payloadExists = payload && Object.values(payload).length;

  if (method === 'get' && payloadExists) {
    tempUrl = tempUrl + '?' + new URLSearchParams(payload as Record<string, string>).toString();
  }

  const base = request(app)[method](`${API_PREFIX}${tempUrl}`);

  // Set session cookies for authentication (better-auth uses cookies)
  if (global.APP_AUTH_COOKIES) base.set('Cookie', global.APP_AUTH_COOKIES);
  if (Object.keys(headers).length) base.set(headers);

  // If not check for non-GET method, MSW will throw "Invariant Violation: Failed to write to a request stream: stream does not exist" error
  if (method !== 'get' && payloadExists) base.send(payload);

  const response = await base;
  const result = (follow ? await followBackgroundJob({ response }) : response) as unknown as CustomResponse<T>;
  return (raw ? extractResponse(result) : result) as MakeRequestReturn<T, R>;
}

/** `inBackground` endpoints answer 202 with a job id; poll it so tests see the final response. */
export async function followBackgroundJob({ response }: { response: request.Response }): Promise<request.Response> {
  let current = response;
  while (current.status === 202 && current.body?.response?.backgroundJobId) {
    await sleep(50);
    const poll = request(app).get(`${API_PREFIX}/background-jobs/${current.body.response.backgroundJobId}`);
    if (global.APP_AUTH_COOKIES) poll.set('Cookie', global.APP_AUTH_COOKIES);
    current = await poll;
  }
  return current;
}

/**
 * Make a raw request to better-auth endpoints.
 * Returns the raw response including headers for cookie extraction.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function makeAuthRequest<T = any>({
  url,
  method,
  payload = null,
  headers = {},
}: Omit<MakeRequestParams<false>, 'raw'>): Promise<request.Response & { body: T }> {
  const base = request(app)[method](`${API_PREFIX}${url}`);

  if (global.APP_AUTH_COOKIES) base.set('Cookie', global.APP_AUTH_COOKIES);
  if (Object.keys(headers).length) base.set(headers);

  if (method !== 'get' && payload) base.send(payload);

  return base;
}

/**
 * Extract session cookies from a response.
 * These should be stored in global.APP_AUTH_COOKIES for subsequent requests.
 */
export function extractCookies(response: request.Response): string {
  const setCookieHeader = response.headers['set-cookie'];
  if (!setCookieHeader) return '';

  // Join all cookies with semicolon for the Cookie header
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

export const sleep = (time = 1000) => {
  return new Promise((resolve) => setTimeout(resolve, time));
};

export const randomDate = (start: Date = new Date(2020, 1, 5), end: Date = new Date()) => {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
};
