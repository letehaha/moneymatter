import { API_RESPONSE_STATUS } from '@bt/shared/types';
import Users from '@models/users.model';
import * as Express from 'express';
import { InferAttributes, Model } from 'sequelize';
import { ZodIssue } from 'zod';

// Enforce res.json(object) to always have `status` field and optional `response`
// with ability to pass `response` type using res.json<Type>()
type ResponseSend<T = Response> = {
  <ResBody>(body: { response?: ResBody; validationErrors?: ZodIssue[]; status: API_RESPONSE_STATUS }): T;
};
export interface CustomRequest extends Express.Request {
  user: InferAttributes<Users, { omit: keyof Model }>;
}
export interface CustomResponse extends Express.Response {
  json: ResponseSend<this>;
}

export type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

export const SESSION_ID_KEY_NAME = 'sessionId';
