/**
 * AI extraction prompt for bank statements
 * Uses CSV format to minimize output tokens
 * Supports PDF, CSV, and TXT input files
 */
import { logger } from '@js/utils';
import { parseDecimalAmount } from '@services/import-export/core/parse/parse-decimal-amount';
import cc from 'currency-codes';

/**
 * System prompt for statement extraction - CSV format for token efficiency
 */
export const STATEMENT_EXTRACTION_SYSTEM_PROMPT = `You are a financial document parser that extracts transaction data from bank statements.
Your task is to analyze bank statement text and extract all transactions into CSV format.

OUTPUT FORMAT:
First line: metadata as comma-separated values
Remaining lines: one transaction per line as comma-separated values

METADATA LINE FORMAT (first line):
bankName,accountLast4,periodFrom,periodTo,currencyCode

TRANSACTION LINE FORMAT (remaining lines):
date,description,merchant,amount,type,balance,confidence,originalAmount,originalCurrency,reference

RULES:
1. Output ONLY CSV data - no headers, no markdown, no explanations
2. First line is ALWAYS metadata
3. Whatever the source looks like, every transaction line you write has the 10 fields
   above, in that order. Never merge two of them into one, never add an eleventh.
4. amount is REQUIRED on every line and must be a plain positive number: digits, at most
   one dot for the decimal point, nothing else. Convert the statement's own convention
   into that one - 1,234.56 and 1.234,56 and 1 234,56 are all the same amount, and all of
   them are written 1234.56. Decide which convention the statement uses by looking at the
   whole document, not one number. Never emit a currency symbol, a thousands separator or
   a decimal comma. A line without a usable amount will be discarded.
5. The output separator is a COMMA, whatever the source uses. Never join several source
   columns into one output field with the source's own separator.
6. Date format: YYYY-MM-DD or YYYY-MM-DD HH:MM:SS (include time if available in the statement)
7. Type: E for expense, I for income
8. Confidence: number 0-100 (integer)
9. Empty value = field not available (just leave empty between commas)
10. If a field contains commas, wrap the WHOLE field in double quotes
11. Include ALL transactions from the statement
12. If time is available for a transaction, ALWAYS include it - this data is valuable
13. merchant: the counterparty / merchant name when separately identifiable
    (e.g. "AMAZON", "Spotify", "UBER TRIP"). Leave EMPTY when no clear merchant
    exists — internal transfers, fees, interest, salary, etc. Do NOT duplicate
    the description if no real merchant is identifiable.
14. originalAmount and originalCurrency: fill them ONLY when the source explicitly shows the
    purchase in a currency other than the account's (e.g. "USD 12.99" beside a EUR charge).
    originalAmount follows the same number rules as amount, originalCurrency is the ISO 4217
    code (USD, EUR, ...). Otherwise leave both empty. Never compute or guess them.
15. reference: the transaction's own reference / ID as printed on the row (e.g. 8F2K91 from
    "Ref 8F2K91"). Never a card number, account number or IBAN. Leave it empty when the row
    has none. Never invent one.

TYPE RULES:
- E (expense): money OUT (purchases, payments, withdrawals, debits)
- I (income): money IN (deposits, credits, refunds, transfers in)

EXAMPLE OUTPUT:
PrivatBank,1234,2025-01-01,2025-01-31,UAH
2025-01-15 14:32:10,Grocery store purchase ATB #123,ATB,250.50,E,,95,,,8F2K91
2025-01-16 09:15:00,"Payment, utilities",,1200.00,E,5000.00,90,,,
2025-01-18,Spotify subscription,Spotify,412.30,E,,95,9.99,USD,
2025-01-20,Salary deposit,,50000.00,I,55000.00,98,,,

When the source is itself tabular (a CSV/TSV export, a statement table), its columns are
rarely the 10 above. Map them; do not copy the source layout. A source row with more
columns than the output has:
  <account> | <category> | <currency> | <amount> | <debit/credit> | <method> | <payee> | <timestamp>
becomes one line that keeps the amount and drops what does not map:
  2025-03-04 12:49:08,Groceries,Fresh Market,1115.00,E,,90,,,
Never emit a line that carries the source's separator or loses the amount, like:
  2025-03-04 12:49:08,Groceries|Card|Fresh Market,E,,90,,,`;

/**
 * User prompt template for text-based extraction
 */
export function createTextExtractionPrompt({ text }: { text: string }): string {
  return `Extract all transactions from this bank statement text:

---
${text}
---

Output CSV only. First line metadata, then transactions.`;
}

/**
 * User prompt for an attached image. The model has no clock, and banking apps print
 * "Today" or "12 Oct", so the date anchors those.
 */
export function createImageExtractionPrompt({ today }: { today: string }): string {
  return `Extract all transactions from the attached image. It may be a photo of a paper statement, a screenshot of a banking app, or a purchase receipt.

A receipt is ONE transaction: its grand total including tax, on the purchase date, with the store as the merchant. Never list a receipt's line items as separate transactions.

Today is ${today}. Resolve relative dates ("Today", "Yesterday") against it, and when a date shows no year, use the latest year that does not put it in the future.

Output CSV only. First line metadata, then transactions.`;
}

/**
 * Expected output structure after parsing CSV
 */
interface AIExtractionOutput {
  transactions: Array<{
    date: string;
    description: string;
    merchant?: string;
    amount: number;
    type: 'income' | 'expense';
    balance?: number | null;
    confidence: number;
    originalAmount?: number;
    originalCurrencyCode?: string;
    externalReference?: string;
  }>;
  metadata: {
    bankName?: string | null;
    accountNumberLast4?: string | null;
    statementPeriod?: {
      from: string;
      to: string;
    } | null;
    currencyCode?: string | null;
  };
  droppedRowCount: number;
}

/** Enough to read a transaction: date, description, merchant, amount, type. */
const MINIMUM_FIELD_COUNT = 5;

/** Where `type` sits in a row the model wrote as asked. */
const TYPE_INDEX = 4;

const TYPE_PATTERN = /^[EI]$/i;

const EXTERNAL_REFERENCE_MAX_LENGTH = 255;

/**
 * The prompt asks for `YYYY-MM-DD HH:MM:SS`, but the model copies full ISO timestamps out
 * of app exports, so the `T` separator, fractional seconds and a zone are all tolerated.
 */
const DATE_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Drops sub-second precision and any zone designator, so the wall clock stands as the statement wrote it. */
function normalizeDate({ date }: { date: string }): string | null {
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;

  return match[2] ? `${match[1]} ${match[2]}` : match[1]!;
}

interface TransactionFields {
  date: string;
  description: string;
  merchant: string;
  amountStr: string;
  typeChar: string;
  balanceStr: string;
  confidenceStr: string;
  originalAmountStr: string;
  originalCurrencyStr: string;
  referenceStr: string;
}

/**
 * Rows are aligned on the type column, not on their width. Optional trailing columns are often
 * left off, so an 8- or 9-field row with E/I fifth is a normal row; a row whose E/I sits further
 * right picked up a column before the amount, and reading it left to right misplaces `amount`.
 */
function readTransactionFields({ fields }: { fields: string[] }): TransactionFields | null {
  if (fields.length < MINIMUM_FIELD_COUNT) return null;

  const typeIndex = Math.max(
    TYPE_INDEX,
    fields.findIndex((field, index) => index >= TYPE_INDEX && TYPE_PATTERN.test(field)),
  );
  const at = (offset: number) => fields[typeIndex + offset] || '';

  const tail = {
    amountStr: at(-1),
    typeChar: at(0),
    balanceStr: at(1),
    confidenceStr: at(2),
    originalAmountStr: at(3),
    originalCurrencyStr: at(4),
    referenceStr: at(5),
  };

  if (typeIndex === TYPE_INDEX) {
    return { date: fields[0] || '', description: fields[1] || '', merchant: fields[2] || '', ...tail };
  }

  const middle = fields.slice(1, typeIndex - 1).filter(Boolean);

  return {
    date: fields[0] || '',
    description: middle[0] || '',
    // Anything past the description is the model's own extra column plus the merchant
    merchant: middle.length > 1 ? middle[middle.length - 1]! : '',
    ...tail,
  };
}

function readOriginalAmount({ amountStr, currencyStr }: { amountStr: string; currencyStr: string }): {
  originalAmount?: number;
  originalCurrencyCode?: string;
} {
  const originalAmount = parseDecimalAmount({ raw: amountStr });
  const originalCurrencyCode = currencyStr.toUpperCase();

  if (originalAmount === null || originalAmount <= 0 || cc.code(originalCurrencyCode) === undefined) return {};

  return { originalAmount, originalCurrencyCode };
}

/** `parseDecimalAmount` rejects signed input, and a balance can be negative when the account is overdrawn. */
function parseBalance({ raw }: { raw: string }): number | null {
  const isNegative = raw.startsWith('-');
  const magnitude = parseDecimalAmount({ raw: isNegative ? raw.slice(1) : raw });

  if (magnitude === null) return null;
  return isNegative ? -magnitude : magnitude;
}

/**
 * Parse a CSV line handling quoted fields with commas
 */
function parseCSVLine({ line }: { line: string }): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Parse CSV response from AI into structured output
 */
export function parseAIResponse({ response }: { response: string }): AIExtractionOutput | null {
  try {
    // Clean up response - remove any markdown code blocks
    let csvContent = response.trim();

    if (csvContent.startsWith('```csv')) {
      csvContent = csvContent.slice(6);
    } else if (csvContent.startsWith('```')) {
      csvContent = csvContent.slice(3);
    }

    if (csvContent.endsWith('```')) {
      csvContent = csvContent.slice(0, -3);
    }

    csvContent = csvContent.trim();

    const lines = csvContent.split('\n').filter((line) => line.trim());

    if (lines.length < 1) {
      logger.info('[Statement Parser] CSV parsing: no lines found in the AI response');
      return null;
    }

    // Parse metadata (first line)
    const metadataFields = parseCSVLine({ line: lines[0]! });
    const metadata: AIExtractionOutput['metadata'] = {
      bankName: metadataFields[0] || null,
      accountNumberLast4: metadataFields[1] || null,
      statementPeriod:
        metadataFields[2] && metadataFields[3]
          ? {
              from: metadataFields[2],
              to: metadataFields[3],
            }
          : null,
      currencyCode: metadataFields[4] || null,
    };

    // Parse transactions (remaining lines)
    const transactions: AIExtractionOutput['transactions'] = [];
    // Counted per reason rather than logged per row, because a big statement from a bad
    // model drops hundreds of rows and a line each would flood the log.
    const droppedByReason = { tooFewColumns: 0, unreadableDate: 0, unusableAmount: 0 };

    for (let i = 1; i < lines.length; i++) {
      const parsedFields = readTransactionFields({ fields: parseCSVLine({ line: lines[i]! }) });

      if (!parsedFields) {
        droppedByReason.tooFewColumns += 1;
        continue;
      }

      const {
        description,
        merchant,
        amountStr,
        typeChar,
        balanceStr,
        confidenceStr,
        originalAmountStr,
        originalCurrencyStr,
        referenceStr,
      } = parsedFields;

      const date = normalizeDate({ date: parsedFields.date });
      if (!date) {
        droppedByReason.unreadableDate += 1;
        continue;
      }

      // The import rejects zero as well as negative, so letting either through here only
      // moves the failure to the end of the flow.
      const amount = parseDecimalAmount({ raw: amountStr });
      if (amount === null || amount <= 0) {
        droppedByReason.unusableAmount += 1;
        continue;
      }

      const type = typeChar.toUpperCase() === 'I' ? 'income' : 'expense';
      const balance = balanceStr ? parseBalance({ raw: balanceStr }) : null;
      const confidence = Math.min(100, Math.max(0, parseInt(confidenceStr, 10) || 80)) / 100;

      transactions.push({
        date,
        description,
        merchant: merchant || undefined,
        amount,
        type,
        balance: balance ?? undefined,
        confidence,
        ...readOriginalAmount({ amountStr: originalAmountStr, currencyStr: originalCurrencyStr }),
        externalReference: referenceStr.slice(0, EXTERNAL_REFERENCE_MAX_LENGTH) || undefined,
      });
    }

    const droppedRowCount =
      droppedByReason.tooFewColumns + droppedByReason.unreadableDate + droppedByReason.unusableAmount;

    logger.info(
      `[Statement Parser] CSV parsing: extracted ${transactions.length} transactions, dropped ${droppedRowCount}`,
      droppedRowCount > 0 ? droppedByReason : undefined,
    );

    return { transactions, metadata, droppedRowCount };
  } catch (error) {
    logger.error({
      message: '[Statement Parser] CSV parsing error',
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return null;
  }
}
