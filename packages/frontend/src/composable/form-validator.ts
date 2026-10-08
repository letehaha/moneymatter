import { i18n } from '@/i18n';
import useVuelidate, { ExtractState, GlobalConfig, ValidationArgs } from '@vuelidate/core';
import { get as safeGet } from 'lodash-es';
import { ComputedRef, Ref, ToRefs, isRef } from 'vue';

const GENERIC_VALIDATION_MESSAGE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  email: 'validation.emailInvalid',
  required: 'validation.required',
});

/**
 * useFormValidation contains a list of methods which allow to validate the
 * specified form using specifield list of rules
 *
 * Example of definition:
 *
 * ```js
 * const form = ref({ email: '' });
 *
 * const { isFormValid, getFieldErrorMessage } = useFormValidation(
 *  // form itself
 *  { form },
 *  {
 *    // validation rules should have the same structure as a form
 *    form: {
 *      email: {
 *        // Record of field's validation rules.
 *        // Record key - name of validation rule. Used to decide which
 *        //              message getErrorMessage method should return
 *        // Record value - function which returns 'true' if field is valid
 *        email: emailValidationFunction,
 *       },
 *     },
 *   }
 * );
 * ```
 *
 * @param form - the record of fields
 * @param rules - list of validation rules which will be used to
 *                validate the form
 * @param vuelidateOptions - list of vuelidate options
 * @param validationOptions - list of custom options
 *
 * @returns list of methods
 */

export const useFormValidation = <Vargs extends ValidationArgs, T extends ExtractState<Vargs>>(
  form: T | Ref<T> | ToRefs<T>,
  rules: Ref<Vargs> | Vargs,
  vuelidateOptions?: GlobalConfig,
  validationOptions?: {
    customValidationMessages: Record<string, string | Ref<string> | ComputedRef<string>>;
  },
): {
  isFormValid: (formPart?: string) => boolean;
  touchField: (fieldPath: string) => void;
  getFieldErrorMessage: (fieldPath: string) => string;
  resetValidation: () => void;
} => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instance = useVuelidate(rules, form as any, vuelidateOptions);

  /**
   * isFormValid touches the whole form or part of it and returns validation status
   *
   * @param formPart - the string with the field or fields group name
   *
   * @returns validation status
   */
  const isFormValid = (formPart?: string): boolean => {
    let isValid = true;
    let localInstance = instance.value;

    if (formPart) {
      localInstance = safeGet(localInstance, formPart);
    }
    if (!localInstance) {
      // in case we have no validation rules at all
      return isValid;
    }
    localInstance.$touch();

    isValid = !localInstance.$invalid;
    return isValid;
  };

  /**
   * touchField allows to call vuelidate $touch method on specified field, so
   * that this field will be validated
   *
   * @param fieldPath - the string with the field name. Works also for nested
   *                    fields, such as 'form.email'.
   */
  const touchField = (fieldPath: string) => {
    const field = safeGet(instance.value, fieldPath);
    if (field) {
      field.$touch();
    }
  };

  // oxlint-disable-next-line no-underscore-dangle
  const _extractVuelidateField = (fieldPath = '') => {
    const resultFieldPath = fieldPath.trim().replace(
      /(\w+)(\[\d+\])/, // path like "array[12]"
      '$1.$each$2', // replace with "array.$each[12]"
    ); // all the others path should be treated unmodified

    return safeGet(instance.value, resultFieldPath);
  };

  /**
   * getFieldErrorMessage decides if the validation error is present
   * for the field. To be invalid the vuelidate $touch method should
   * be called on it. You have to call $touch on the level of your component,
   * the good time to do this is `input`, `change` or `blur-sm` events:
   *
   *   <input-field
   *     v-model="form.email"
   *     @blur="touchField('form.email')"
   *     :error-message="getFieldErrorMessage('form.email')"
   *  />
   *
   * @param fieldPath - the string with the field name. Works also for nested
   *                    fields, such as 'form.email'.
   *
   * @returns the human-readable error message if the field is invalid,
   *          empty string - otherwise.
   */
  const getFieldErrorMessage = (fieldPath: string): string => {
    if (!fieldPath) {
      // eslint-disable-next-line no-console
      console.error('getFieldErrorMessage: "fieldPath" is required');
    }

    if (!instance.value.$invalid) {
      return '';
    }

    const field = _extractVuelidateField(fieldPath);
    if (!field || !Object.keys(field).length) {
      return '';
    }

    // makes dirty only after $touch call
    if (!field.$dirty) {
      return '';
    }

    const fieldRules = safeGet(isRef(rules) ? rules.value : rules, fieldPath);
    if (!fieldRules) {
      return '';
    }

    for (const rule of Object.keys(fieldRules)) {
      if (field[rule].$invalid) {
        const customMessage = validationOptions?.customValidationMessages[rule];

        const customErrorMessage = isRef(customMessage) ? customMessage.value : customMessage;

        const genericMessageKey = GENERIC_VALIDATION_MESSAGE_KEYS[rule];

        return (
          customErrorMessage || (genericMessageKey && i18n.global.t(genericMessageKey)) || field[rule].$message || ''
        );
      }
    }
    return '';
  };

  const resetValidation = () => {
    instance.value.$reset();
  };

  return {
    touchField,
    isFormValid,
    getFieldErrorMessage,
    resetValidation,
  };
};
