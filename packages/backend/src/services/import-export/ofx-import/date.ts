import { anchorImportDate } from '@services/import-export/core/parse/anchor-import-date';

import { OfxParseError } from './types';

const OFX_DATE =
  /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})(?:\.(\d+))?)?(?:\[([+-]?\d+(?:\.\d+)?)(?::[^\]]*)?\])?$/;

export function parseOfxDate({ value, timezone }: { value: string; timezone?: string }): string {
  const match = OFX_DATE.exec(value.trim());
  if (!match) throw new OfxParseError({ code: 'invalid-date', key: 'ofxImport.errors.invalidDate', params: { value } });

  const [, year, month, day, hour, minute = '00', second = '00', fraction = '', offset] = match;
  const hasTime = hour !== undefined;
  const hasOffset = offset !== undefined;
  const resolvedHour = hour ?? '00';
  const hourNumber = Number(resolvedHour);
  const minuteNumber = Number(minute);
  const secondNumber = Number(second);
  const offsetNumber = Number(offset ?? '0');
  if (
    hourNumber > 23 ||
    minuteNumber > 59 ||
    secondNumber > 59 ||
    !Number.isFinite(offsetNumber) ||
    Math.abs(offsetNumber) > 24
  ) {
    throw new OfxParseError({ code: 'invalid-date', key: 'ofxImport.errors.invalidDate', params: { value } });
  }
  const milliseconds = Number(`0.${fraction || '0'}`) * 1000;
  const calendarDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    calendarDate.getUTCFullYear() !== Number(year) ||
    calendarDate.getUTCMonth() !== Number(month) - 1 ||
    calendarDate.getUTCDate() !== Number(day)
  ) {
    throw new OfxParseError({ code: 'invalid-date', key: 'ofxImport.errors.invalidDate', params: { value } });
  }

  if (!hasOffset) {
    // OFX permits local timestamps with no offset. Anchor these in the browser
    // timezone so the import day does not change with the server timezone.
    const parsed = hasTime
      ? {
          kind: 'localDateTime' as const,
          year: Number(year),
          month: Number(month),
          day: Number(day),
          hour: hourNumber,
          minute: minuteNumber,
          second: secondNumber,
          ms: milliseconds,
        }
      : { kind: 'dateOnly' as const, year: Number(year), month: Number(month), day: Number(day) };
    return anchorImportDate({ parsed, timezone }).toISOString();
  }

  // An OFX offset is a decimal number of hours east or west of UTC.
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    hourNumber,
    minuteNumber,
    secondNumber,
    milliseconds,
  );
  const date = new Date(timestamp - offsetNumber * 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) {
    throw new OfxParseError({ code: 'invalid-date', key: 'ofxImport.errors.invalidDate', params: { value } });
  }
  try {
    return date.toISOString();
  } catch {
    throw new OfxParseError({ code: 'invalid-date', key: 'ofxImport.errors.invalidDate', params: { value } });
  }
}
