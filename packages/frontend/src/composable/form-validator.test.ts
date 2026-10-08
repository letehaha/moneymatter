import { i18n, loadChunks } from '@/i18n';
import { email, required } from '@/js/helpers/validators';
import { computed, ref } from 'vue';

import { useFormValidation } from './form-validator';

describe('useFormValidation', () => {
  const validEmail = 'test@example.com';
  const invalidEmail = 'foo';
  describe('isFormValid', () => {
    it('returns true for the whole form when form is ref and is valid', () => {
      const form = ref({
        email: validEmail,
      });
      const { isFormValid } = useFormValidation({ form }, { form: { email: { email } } });

      expect(isFormValid()).toBe(true);
    });
    it('returns true for the whole form when form is a raw object and is valid', () => {
      const form = {
        email: validEmail,
      };
      const { isFormValid } = useFormValidation({ form }, { form: { email: { email } } });

      expect(isFormValid()).toBe(true);
    });
    it('returns false if form is invalid', () => {
      const form = {
        email: invalidEmail,
      };
      const { isFormValid } = useFormValidation({ form }, { form: { email: { email } } });

      expect(isFormValid()).toBe(false);
    });
    it('returns true for the part of form if it is valid', () => {
      const form = {
        subform: {
          email: validEmail,
        },
      };
      const { isFormValid } = useFormValidation({ form }, { form: { subform: { email: { email } } } });

      expect(isFormValid('form.subform')).toBe(true);
    });
    it('returns false for the part of form if it is invalid', () => {
      const form = {
        subform: {
          email: invalidEmail,
        },
      };
      const { isFormValid } = useFormValidation({ form }, { form: { subform: { email: { email } } } });

      expect(isFormValid('form.subform')).toBe(false);
    });
    it('returns true if there is no validation rules', () => {
      const form = {
        email: invalidEmail,
      };
      const { isFormValid } = useFormValidation({ form }, {});

      expect(isFormValid('form')).toBe(true);
    });
  });
  describe('getFieldErrorMessage', () => {
    it('returns nothing in case field is not invalid', () => {
      const form = ref({
        email: validEmail,
      });
      const { getFieldErrorMessage, touchField } = useFormValidation({ form }, { form: { email: { email } } });

      touchField('form.email');

      expect(getFieldErrorMessage('form.email')).toBe('');
    });
    it('returns nothing in case form part is not invalid', () => {
      const form = ref({
        email: validEmail,
      });
      const { getFieldErrorMessage, touchField } = useFormValidation({ form }, { form: { email: { email } } });

      touchField('form.email');

      expect(getFieldErrorMessage('form')).toBe('');
    });
    it('returns nothing in case field is not dirty', () => {
      const form = ref({
        email: invalidEmail,
      });
      const { getFieldErrorMessage } = useFormValidation({ form }, { form: { email: { email } } });

      expect(getFieldErrorMessage('form.email')).toBe('');
    });
    it('returns correct error message', () => {
      const form = ref({
        email: invalidEmail,
      });
      const { getFieldErrorMessage, touchField } = useFormValidation({ form }, { form: { email: { email } } });

      touchField('form.email');

      expect(getFieldErrorMessage('form.email')).not.toBe('');
    });
    it("uses default `email` error message if message for custom rule doesn't exist", () => {
      const form = ref({
        email: invalidEmail,
      });
      const randomRule = 'randomRule';
      const { getFieldErrorMessage, touchField } = useFormValidation(
        { form },
        { form: { email: { [randomRule]: email } } },
      );

      touchField('form.email');

      expect(getFieldErrorMessage('form.email')).toBe('Value is not a valid email address');
    });
    it('returns custom error message if it is passed and form is invalid', () => {
      const form = ref({
        email: invalidEmail,
      });
      const randomRule = 'randomRule';
      const randomRuleMessage = 'This random field is invalid';
      const customValidationMessages = {
        [randomRule]: randomRuleMessage,
      };
      const { getFieldErrorMessage, touchField } = useFormValidation(
        { form },
        { form: { email: { [randomRule]: email } } },
        undefined,
        { customValidationMessages },
      );

      touchField('form.email');

      expect(getFieldErrorMessage('form.email')).toBe(randomRuleMessage);
    });
    it('returns custom error message which has Ref format', () => {
      const form = ref({
        email: invalidEmail,
      });
      const randomRule = 'randomRule';
      const randomRuleMessage = 'This random field is invalid';
      const customValidationMessages = {
        [randomRule]: ref(randomRuleMessage),
      };
      const { getFieldErrorMessage, touchField } = useFormValidation(
        { form },
        { form: { email: { [randomRule]: email } } },
        undefined,
        { customValidationMessages },
      );

      touchField('form.email');

      expect(getFieldErrorMessage('form.email')).toBe(randomRuleMessage);
    });
    it('returns custom error message which has ComputedRef format', () => {
      const form = ref({
        email: invalidEmail,
      });
      const randomRule = 'randomRule';
      const randomRuleMessage = 'This random field is invalid';
      const customValidationMessages = {
        [randomRule]: computed(() => randomRuleMessage),
      };
      const { getFieldErrorMessage, touchField } = useFormValidation(
        { form },
        { form: { email: { [randomRule]: email } } },
        undefined,
        { customValidationMessages },
      );

      touchField('form.email');

      expect(getFieldErrorMessage('form.email')).toBe(randomRuleMessage);
    });
    describe('generic messages', () => {
      afterEach(() => {
        i18n.global.locale.value = 'en';
      });

      it('returns the generic `required` message in the active locale', async () => {
        const form = ref({ name: '' });
        const { getFieldErrorMessage, touchField } = useFormValidation({ form }, { form: { name: { required } } });

        touchField('form.name');

        const englishMessage = getFieldErrorMessage('form.name');
        expect(englishMessage).toBe('Field is required');

        await loadChunks({ locale: 'uk', chunks: ['common'] });
        i18n.global.locale.value = 'uk';

        const ukrainianMessage = getFieldErrorMessage('form.name');
        expect(ukrainianMessage).toBe(i18n.global.t('validation.required'));
        expect(ukrainianMessage).not.toBe(englishMessage);
      });
    });
  });
});
