import { describe, expect, it } from '@jest/globals';

import { FINANCIAL_DATA_GUIDE_CONTENT } from '../../mcp/prompts/financial-data-guide';
import { buildSystemPrompt, CHAT_PROMPT_VERSION } from './system-prompt';

const params = {
  now: new Date('2026-10-18T14:30:00Z'),
  timeZone: 'UTC',
  locale: 'uk',
  baseCurrency: 'EUR',
  pageContext: null,
};

describe('buildSystemPrompt', () => {
  it('names a prompt version', () => {
    expect(CHAT_PROMPT_VERSION).toMatch(/^chat-\d+$/);
  });

  it('prints the clock and the date in the zone it names', () => {
    const prompt = buildSystemPrompt({ ...params, now: new Date('2026-10-18T22:30:00Z'), timeZone: 'Europe/Kyiv' });

    expect(prompt).toContain('Now: 2026-10-19 01:30 (Europe/Kyiv); today is 2026-10-19.');
  });

  it('prints the UTC clock when the zone is UTC', () => {
    expect(buildSystemPrompt(params)).toContain('Now: 2026-10-18 14:30 (UTC); today is 2026-10-18.');
  });

  describe('rules for corrections, transfers and what the cards produced', () => {
    const prompt = buildSystemPrompt(params);

    it('takes the time of a transaction from its source, not from the clock', () => {
      expect(prompt).toMatch(/time comes from its source/i);
      expect(prompt).toMatch(/use the source's time/i);
    });

    it('reads a short reply after a pending card as a correction of that card', () => {
      expect(prompt).toMatch(/short reply right after you proposed a card that is still pending/i);
      expect(prompt).toMatch(/Do not ask whether it is a correction or a new request/);
    });

    it('allows one card for the edit of a transfer, not one per leg', () => {
      expect(prompt).toMatch(/never one card per leg/i);
    });

    it('asks for the record of every option that picks one, and says a card with another id is refused', () => {
      expect(prompt).toMatch(/give each option its "record"/);
      expect(prompt).toMatch(/a card with another id is refused/);
    });

    it('has answers about cards come from their state, arguments and result, not from memory', () => {
      expect(prompt).toMatch(/never from memory/i);
      expect(prompt).toMatch(/pending, which are applied/i);
      expect(prompt).toMatch(/from their "result" lines, not from the arguments/);
    });
  });

  it('has the role and the two modes, and never lets the model claim a change is done', () => {
    const prompt = buildSystemPrompt(params);

    expect(prompt).toContain('MoneyMatter');
    expect(prompt).toMatch(/Acting/);
    expect(prompt).toMatch(/Answering/);
    expect(prompt).toMatch(/never (say|claim)[^.]*(done|applied|made)/i);
    expect(prompt).toMatch(/cards are the only way/i);
  });

  it('keeps transfers between the user own accounts out of spending and ties the text to the visuals', () => {
    const prompt = buildSystemPrompt(params);

    expect(prompt).toMatch(/transfers? between (the user's )?own accounts/i);
    expect(prompt).toMatch(/not (spending|income)/i);
    expect(prompt).toContain('excludeTransfers');
    expect(prompt).toMatch(/never (restate|quote)[^.]*(differ|visual)/i);
  });

  it('stops a delete or an update whose record differs from what the user said, and asks instead', () => {
    const prompt = buildSystemPrompt(params);

    expect(prompt).toMatch(/amount, date, payee and account/i);
    expect(prompt).toMatch(/differs?[^.]*do not propose/i);
    expect(prompt).toMatch(/clarification option[^.]*(amount|date)/i);
  });

  it('takes the payment type from the account history and never guesses cash', () => {
    expect(buildSystemPrompt(params)).toMatch(/paymentType[^.]*(recent transactions|same account)/i);
    expect(buildSystemPrompt(params)).toMatch(/never[^.]*cash/i);
  });

  it('asks the model to name the conversation once, only while it has no name of its own', () => {
    const named = buildSystemPrompt({ ...params, nameThread: true });

    expect(named).toContain('set_thread_title');
    expect(named).toMatch(/3 to 6 words/);
    expect(named).toMatch(/language of the user/i);
    expect(buildSystemPrompt({ ...params, nameThread: false })).not.toContain('set_thread_title');
    expect(buildSystemPrompt(params)).not.toContain('set_thread_title');
  });

  it('has the card rules: one call per change, refs, uncertain fields, clarification', () => {
    const prompt = buildSystemPrompt(params);

    expect(prompt).toContain('$proposal:');
    expect(prompt).toContain('_chat.uncertain');
    expect(prompt).toContain('_chat.replaces');
    expect(prompt).toContain('_chat.sourceCallIds');
    expect(prompt).toContain('ask_clarification');
    expect(prompt).toContain('find_capabilities');
    expect(prompt).toMatch(/one (tool )?call per change/i);
  });

  it('forbids text in an acting turn that ends with cards, and requires a sentence when none is proposed', () => {
    const prompt = buildSystemPrompt(params);

    expect(prompt).toMatch(/acting turn that ends with cards, write no text/i);
    expect(prompt).toMatch(/neither a card nor a sentence/i);
  });

  it('logs a payment picture sent with no or vague text: search for it first, then propose or say it exists', () => {
    const prompt = buildSystemPrompt(params);

    expect(prompt).toMatch(/is a request to log it\. Do not ask what the user wants/);
    expect(prompt).toMatch(/search_transactions for the same amount within a day/);
    expect(prompt).toMatch(/already logged/);
    expect(prompt).toMatch(/propose create_transaction right away/);
  });

  it('tells the model to revise a pending card by replacing it, never by updating a $proposal ref', () => {
    expect(buildSystemPrompt(params)).toMatch(/Never call an update or delete tool with a "\$proposal:" ref/);
  });

  it('has the answering rules: numbers from results, visuals through the render tools', () => {
    const prompt = buildSystemPrompt(params);

    expect(prompt).toMatch(/numbers? (come|must come|only)[^.]*(tool|analysis) results?/i);
    for (const tool of ['render_chart', 'render_table', 'render_kpis']) expect(prompt).toContain(tool);
    expect(prompt).toMatch(/plain text/i);
  });

  it('tells the model when to run an analysis and that its numbers count as results', () => {
    const prompt = buildSystemPrompt(params);

    expect(prompt).toContain('run_analysis');
    expect(prompt).toMatch(/run_analysis[^.]*(read|tool) results?/i);
    expect(prompt).toMatch(/source[^.]*analysisId/);
    expect(prompt).toMatch(/at most 5 analyses|5 analyses/i);
  });

  it('includes the financial data guide the MCP server serves', () => {
    expect(buildSystemPrompt(params)).toContain(FINANCIAL_DATA_GUIDE_CONTENT);
  });

  it('states the date, time zone, locale and base currency', () => {
    const prompt = buildSystemPrompt(params);

    expect(prompt).toContain('2026-10-18');
    expect(prompt).toContain('UTC');
    expect(prompt).toContain('uk');
    expect(prompt).toContain('Ukrainian');
    expect(prompt).toContain('EUR');
  });

  it('says the base currency is unknown when the user has none yet', () => {
    expect(buildSystemPrompt({ ...params, baseCurrency: null })).toMatch(/base currency[^.]*not (set|chosen)/i);
  });

  it('has the untrusted-data rule', () => {
    const prompt = buildSystemPrompt(params);

    expect(prompt).toContain('<<<UNTRUSTED');
    expect(prompt).toMatch(/never (follow|obey)[^.]*instructions/i);
  });

  it('adds the page context only when there is one', () => {
    const without = buildSystemPrompt(params);
    const withContext = buildSystemPrompt({ ...params, pageContext: 'PAGE-CONTEXT-BLOCK' });

    expect(without).not.toContain('PAGE-CONTEXT-BLOCK');
    expect(withContext).toContain('PAGE-CONTEXT-BLOCK');
  });
});
