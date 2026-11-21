import { PORTFOLIO_TYPE } from '@bt/shared/types/investments';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

describe('Create Portfolio Service E2E', () => {
  describe('POST /investments/portfolios', () => {
    it('should handle explicit fields, defaults, disabled flag, name trimming, every portfolio type and repeated creates', async () => {
      const fullResponse = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({
          name: 'My Investment Portfolio',
          portfolioType: PORTFOLIO_TYPE.investment,
          description: 'A test investment portfolio',
        }),
      });

      expect(fullResponse.statusCode).toBe(200);
      expect(helpers.extractResponse(fullResponse)).toMatchObject({
        name: 'My Investment Portfolio',
        portfolioType: PORTFOLIO_TYPE.investment,
        description: 'A test investment portfolio',
        isEnabled: true,
      });

      const minimalPortfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Minimal Portfolio' }),
        raw: true,
      });

      expect(minimalPortfolio).toMatchObject({
        name: 'Minimal Portfolio',
        portfolioType: PORTFOLIO_TYPE.investment,
        isEnabled: true,
      });
      expect(minimalPortfolio.description).toBe('Test portfolio description');

      const disabledPortfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Disabled Portfolio', isEnabled: false }),
        raw: true,
      });

      expect(disabledPortfolio.isEnabled).toBe(false);

      const trimmedPortfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: '  Trimmed Portfolio  ' }),
        raw: true,
      });

      expect(trimmedPortfolio.name).toBe('Trimmed Portfolio');

      const portfolioTypes = [
        PORTFOLIO_TYPE.investment,
        PORTFOLIO_TYPE.retirement,
        PORTFOLIO_TYPE.savings,
        PORTFOLIO_TYPE.other,
      ];

      for (const portfolioType of portfolioTypes) {
        const portfolio = await helpers.createPortfolio({
          payload: helpers.buildPortfolioPayload({ name: `${portfolioType} Portfolio`, portfolioType }),
          raw: true,
        });

        expect(portfolio.portfolioType).toBe(portfolioType);
      }

      const portfolio1 = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Portfolio 1', portfolioType: PORTFOLIO_TYPE.investment }),
        raw: true,
      });
      const portfolio2 = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Portfolio 2', portfolioType: PORTFOLIO_TYPE.retirement }),
        raw: true,
      });

      expect(portfolio1.name).toBe('Portfolio 1');
      expect(portfolio2.name).toBe('Portfolio 2');
      expect(portfolio1.userId).toBe(portfolio2.userId);
    }, 30000);

    it('should create a portfolio with a display currency when it is connected', async () => {
      await helpers.addUserCurrencyByCode({ code: 'EUR', raw: true });

      const portfolio = await helpers.createPortfolio({
        payload: { name: 'Broker View Portfolio', displayCurrencyCode: 'EUR' },
        raw: true,
      });

      expect(portfolio.displayCurrencyCode).toBe('EUR');
    });

    it('allows two portfolios with the same name for the same user', async () => {
      // Duplicate names are no longer rejected — the (userId, name) DB
      // uniqueness was dropped (see 20260524000000-drop-portfolios-unique-name).
      // This test locks the new behaviour so we notice if the constraint ever
      // creeps back in.
      const portfolioData = helpers.buildPortfolioPayload({ name: 'Duplicate Portfolio' });

      const first = await helpers.createPortfolio({ payload: portfolioData });
      expect(first.statusCode).toBe(200);

      const second = await helpers.createPortfolio({ payload: portfolioData });
      expect(second.statusCode).toBe(200);
    });

    it('should reject an empty or too long name, a too long description, an invalid type and an unconnected display currency', async () => {
      const emptyName = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: '' }),
      });
      expect(emptyName.statusCode).toBe(ERROR_CODES.ValidationError);

      const longName = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'a'.repeat(101) }),
      });
      expect(longName.statusCode).toBe(ERROR_CODES.ValidationError);

      const longDescription = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Valid Portfolio', description: 'a'.repeat(501) }),
      });
      expect(longDescription.statusCode).toBe(ERROR_CODES.ValidationError);

      const invalidType = await helpers.createPortfolio({
        payload: {
          ...helpers.buildPortfolioPayload(),
          portfolioType: 'invalid_type' as PORTFOLIO_TYPE,
        },
      });
      expect(invalidType.statusCode).toBe(ERROR_CODES.ValidationError);

      const unconnectedCurrency = await helpers.createPortfolio({
        payload: { name: 'Broker View Portfolio', displayCurrencyCode: 'PLN' },
      });
      expect(unconnectedCurrency.statusCode).toBe(ERROR_CODES.ValidationError);
    }, 30000);

    it('should create a portfolio with null externalUrl by default or an optional http(s) URL, and reject invalid URLs', async () => {
      const withoutUrl = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'No URL Portfolio' }),
        raw: true,
      });
      expect(withoutUrl.externalUrl).toBeNull();

      const withUrl = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({
          name: 'Fidelity Portfolio',
          externalUrl: 'https://www.fidelity.com/',
        }),
        raw: true,
      });
      expect(withUrl.externalUrl).toBe('https://www.fidelity.com/');

      for (const badUrl of [
        'ftp://broker.example',
        'javascript:alert(1)',
        'not-a-url',
        `https://broker.example/${'a'.repeat(2049)}`,
      ]) {
        const res = await helpers.createPortfolio({
          payload: helpers.buildPortfolioPayload({ name: 'Bad URL Portfolio', externalUrl: badUrl }),
        });
        expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
      }
    });
  });
});
