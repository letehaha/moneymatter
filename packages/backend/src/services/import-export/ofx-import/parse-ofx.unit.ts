import fs from 'node:fs';
import path from 'node:path';

import { parseOfx } from './parse-ofx';
import { OfxParseError } from './types';

function fixture({ name }: { name: string }): Buffer {
  return fs.readFileSync(path.join(__dirname, '../../../tests/fixtures/ofx-import', name));
}

function withHeader({
  body,
  charset = '1252',
  encoding = 'USASCII',
  version = '102',
}: {
  body: string;
  charset?: string;
  encoding?: string;
  version?: string;
}): Buffer {
  return Buffer.from(
    `OFXHEADER:100\nDATA:OFXSGML\nVERSION:${version}\nENCODING:${encoding}\nCHARSET:${charset}\nCOMPRESSION:NONE\n\n${body}`,
    encoding === 'UTF-8' ? 'utf8' : 'latin1',
  );
}

function bankStatementWithRows({ rows }: { rows: string }): string {
  return `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD<BANKACCTFROM><BANKID>1<ACCTID>1234<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST>${rows}</BANKTRANLIST><LEDGERBAL><BALAMT>0<DTASOF>20260801</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
}

describe('parseOfx', () => {
  it('maps an OFX 1.x bank statement and aggregates fallback warnings', () => {
    const result = parseOfx({ bytes: fixture({ name: 'bank-v1.ofx' }) });

    expect(result.formatVersion).toBe('1.x');
    expect(result.financialInstitutionName).toBe('Example Bank');
    expect(result.accounts).toEqual([
      expect.objectContaining({
        accountType: 'CHECKING',
        currency: 'USD',
        ledgerBalance: '87.66',
        maskedDisplayName: 'CHECKING ••••2222',
        transactionCount: 2,
      }),
    ]);
    expect(result.transactions[0]).toEqual(
      expect.objectContaining({
        amount: '-12.34',
        checkNumber: '42',
        date: '2026-08-01T16:00:00.000Z',
        note: 'Sanitized purchase',
        payeeName: 'Example Shop',
        referenceNumber: 'ref-1',
        transactionType: 'DEBIT',
        type: 'expense',
      }),
    );
    expect(result.transactions[0]!.sourceTransactionKey).toMatch(/^[a-f0-9]{64}$/);
    expect(result.transactions[1]).not.toHaveProperty('sourceTransactionKey');
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'date-user-fallback', count: 1 }),
        expect.objectContaining({ code: 'fitid-missing', count: 1 }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('000011112222');
  });

  it('maps OFX 2.x XML without converting the source decimal before Money validation', () => {
    const result = parseOfx({ bytes: fixture({ name: 'bank-v2.ofx' }) });
    expect(result.formatVersion).toBe('2.x');
    expect(result.transactions[0]).toEqual(
      expect.objectContaining({ amount: '0.123456', date: '2026-08-03T08:30:00.125Z', payeeName: 'Example Payee' }),
    );
  });

  it('accepts the standard OFX 2.x processing-instruction header', () => {
    const source = fixture({ name: 'bank-v2.ofx' }).toString('utf8');
    const body = source.slice(source.indexOf('<OFX>'));
    const bytes = Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>\n<?OFX OFXHEADER="200" VERSION="203" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>\n${body}`,
    );

    expect(parseOfx({ bytes }).formatVersion).toBe('2.x');
  });

  it('accepts blank lines around a standard OFX 2.x declaration', () => {
    const source = fixture({ name: 'bank-v2.ofx' }).toString('utf8');
    const body = source.slice(source.indexOf('<OFX>'));
    const bytes = Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>\n\n<?OFX OFXHEADER="200" VERSION="203" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>\n\n${body}`,
    );

    expect(parseOfx({ bytes }).formatVersion).toBe('2.x');
  });

  it('maps a QFX credit-card statement and decodes Windows-1252', () => {
    const source = fixture({ name: 'card.qfx' }).toString('ascii').replace('Caf&#233;', '\x80 Café');
    const bytes = Buffer.from(source, 'latin1');
    const result = parseOfx({ bytes });
    expect(result.accounts[0]).toEqual(
      expect.objectContaining({ statementType: 'credit-card', maskedDisplayName: 'CREDITCARD ••••7777' }),
    );
    expect(result.transactions[0]!.payeeName).toBe('€ Café Example');
  });

  it('rejects malformed OFX 2.x XML instead of using the SGML fallback', () => {
    const body = '<OFX><BANKMSGSRSV1></OFX>';
    expect(() => parseOfx({ bytes: withHeader({ body, charset: 'NONE', encoding: 'UTF-8', version: '203' }) })).toThrow(
      'ofxImport.errors.tagsMismatch',
    );
  });

  it('collapses identical FITID rows and rejects conflicting rows', () => {
    const row = '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260801<TRNAMT>-1<FITID>same<NAME>Example</STMTTRN>';
    const duplicate = parseOfx({ bytes: withHeader({ body: bankStatementWithRows({ rows: row + row }) }) });
    expect(duplicate.transactions).toHaveLength(1);
    expect(duplicate.warnings).toEqual([expect.objectContaining({ code: 'fitid-duplicate', count: 1 })]);

    const conflict = row.replace('<TRNAMT>-1', '<TRNAMT>-2');
    expect(() => parseOfx({ bytes: withHeader({ body: bankStatementWithRows({ rows: row + conflict }) }) })).toThrow(
      'ofxImport.errors.conflictingFitid',
    );
  });

  it.each([
    ['NAME', 'N'.repeat(201), 200],
    ['MEMO', 'M'.repeat(2_001), 2_000],
  ])('rejects an oversized %s field', (field, text, limit) => {
    const row = `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260801<TRNAMT>-1<FITID>long<${field}>${text}</STMTTRN>`;
    expect.assertions(1);
    try {
      parseOfx({ bytes: withHeader({ body: bankStatementWithRows({ rows: row }) }) });
    } catch (error) {
      expect(error).toEqual(
        expect.objectContaining<Partial<OfxParseError>>({
          key: 'ofxImport.errors.textTooLong',
          params: { field, max: limit },
        }),
      );
    }
  });

  it.each([
    [
      'unknown encoding',
      Buffer.from(
        'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nENCODING:EBCDIC\nCHARSET:500\nCOMPRESSION:NONE\n\n<OFX></OFX>',
      ),
      'unsupported-encoding',
    ],
    [
      'compression',
      Buffer.from(
        'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:GZIP\n\n<OFX></OFX>',
      ),
      'compressed-file',
    ],
    ['DTD', withHeader({ body: '<!DOCTYPE OFX><OFX></OFX>' }), 'prohibited-declaration'],
    ['entity', withHeader({ body: '<!ENTITY x "value"><OFX></OFX>' }), 'prohibited-declaration'],
    [
      'unsupported message set',
      withHeader({ body: '<OFX><INVSTMTMSGSRSV1></INVSTMTMSGSRSV1></OFX>' }),
      'unsupported-message-set',
    ],
  ])('rejects %s input', (_name, bytes, code) => {
    expect.assertions(1);
    try {
      parseOfx({ bytes });
    } catch (error) {
      expect(error).toEqual(expect.objectContaining<Partial<OfxParseError>>({ code }));
    }
  });

  it('rejects correction records', () => {
    const body =
      '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD<BANKACCTFROM><BANKID>1<ACCTID>1234<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260801<TRNAMT>-1<FITID>new<CORRECTFITID>old<CORRECTACTION>REPLACE</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>0<DTASOF>20260801</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';
    expect(() => parseOfx({ bytes: withHeader({ body }) })).toThrow('ofxImport.errors.correctionRecord');
  });

  it('accepts a UTF-8 BOM before the OFX 1.x header', () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fixture({ name: 'bank-v1.ofx' })]);

    expect(parseOfx({ bytes }).transactions).toHaveLength(2);
  });

  it('keeps non-ASCII bytes when the header declares CHARSET:NONE', () => {
    const row = '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260801<TRNAMT>-1<FITID>x<NAME>Caf\u00e9</STMTTRN>';
    const bytes = withHeader({ body: bankStatementWithRows({ rows: row }), charset: 'NONE' });

    expect(parseOfx({ bytes }).transactions[0]!.payeeName).toBe('Caf\u00e9');
  });
});
