import type { ImportJobFailure } from '@bt/shared/types';
import { ValidationError } from '@js/errors';

/**
 * A validation failure that aborts a whole import job. The queue forwards
 * `failure` to the UI, which translates it: the worker has no request locale,
 * so `message` is English there and only serves logs.
 */
export class ImportJobError extends ValidationError {
  readonly failure: ImportJobFailure;

  constructor({ message, failure }: { message: string; failure: ImportJobFailure }) {
    super({ message });
    this.failure = failure;
  }
}
