import { ApiBaseError } from '@/common/types';
import { i18n } from '@/i18n';

/**
 * Authorization error. The message is user-facing; the server detail stays on `data` and `url`.
 *
 * @class
 */
export class AuthError extends Error {
  data: ApiBaseError;
  url?: string;

  constructor(data: ApiBaseError, url?: string) {
    super(i18n.global.t('errors.api.sessionExpired'));

    this.name = 'AuthError';
    this.data = data;
    this.url = url;
  }
}
