import { API_ERROR_CODES, CategoryModel } from '@bt/shared/types';

export interface ApiBaseError {
  statusText?: string;
  code: API_ERROR_CODES;
  message?: string;
  details?: Record<string, unknown>;
}

export interface FormattedCategory extends CategoryModel {
  subCategories: FormattedCategory[];
}

/** Where a dragged category lands relative to the row it is dropped on. */
export type CategoryDropPosition = 'before' | 'inside' | 'after';
