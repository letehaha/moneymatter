import Fuse from 'fuse.js';

interface BankInstitutionEntry {
  name: string;
  aliases: string[];
  domain: string;
}

/**
 * Maps bank institution names (from Enable Banking ASPSP data) to their domains.
 * Used to fetch clean logos via logo.dev.
 * Add new entries as users connect to new banks.
 */
const BANK_INSTITUTIONS: BankInstitutionEntry[] = [
  // Poland
  { name: 'PKO Bank Polski', aliases: ['pko bp', 'pko bank'], domain: 'pkobp.pl' },
  { name: 'mBank', aliases: [], domain: 'mbank.pl' },
  { name: 'ING Bank Śląski', aliases: ['ing'], domain: 'ing.pl' },
  { name: 'Bank Pekao', aliases: ['pekao'], domain: 'pekao.com.pl' },
  { name: 'Santander Bank Polska', aliases: ['santander'], domain: 'santander.pl' },
  { name: 'BNP Paribas Bank Polska', aliases: ['bnp paribas'], domain: 'bnpparibas.pl' },
  { name: 'Alior Bank', aliases: ['alior'], domain: 'aliorbank.pl' },
  { name: 'Bank Millennium', aliases: ['millennium'], domain: 'bankmillennium.pl' },
  { name: 'Credit Agricole', aliases: [], domain: 'credit-agricole.pl' },
  { name: 'Nest Bank', aliases: [], domain: 'nestbank.pl' },
  { name: 'Velo Bank', aliases: ['velobank'], domain: 'velobank.pl' },

  // International / Neobanks
  { name: 'Wise', aliases: ['transferwise'], domain: 'wise.com' },
  { name: 'Revolut', aliases: [], domain: 'revolut.com' },
  { name: 'N26', aliases: [], domain: 'n26.com' },
  { name: 'Bunq', aliases: [], domain: 'bunq.com' },
  { name: 'Monzo', aliases: [], domain: 'monzo.com' },
  { name: 'Starling Bank', aliases: ['starling'], domain: 'starlingbank.com' },

  // Germany
  { name: 'Deutsche Bank', aliases: [], domain: 'deutsche-bank.de' },
  { name: 'Commerzbank', aliases: [], domain: 'commerzbank.de' },
  { name: 'Sparkasse', aliases: [], domain: 'sparkasse.de' },
  { name: 'DKB', aliases: ['deutsche kreditbank'], domain: 'dkb.de' },
  { name: 'ING-DiBa', aliases: ['ing diba'], domain: 'ing.de' },
  { name: 'Comdirect', aliases: [], domain: 'comdirect.de' },

  // Finland / Nordics
  { name: 'Nordea', aliases: [], domain: 'nordea.fi' },
  { name: 'OP Financial Group', aliases: ['op', 'osuuspankki'], domain: 'op.fi' },
  { name: 'Danske Bank', aliases: [], domain: 'danskebank.fi' },
  { name: 'Handelsbanken', aliases: [], domain: 'handelsbanken.se' },
  { name: 'SEB', aliases: ['skandinaviska enskilda banken'], domain: 'seb.se' },
  { name: 'Swedbank', aliases: [], domain: 'swedbank.se' },

  // UK
  { name: 'HSBC', aliases: [], domain: 'hsbc.co.uk' },
  { name: 'Barclays', aliases: [], domain: 'barclays.co.uk' },
  { name: 'Lloyds Bank', aliases: ['lloyds'], domain: 'lloydsbank.com' },
  { name: 'NatWest', aliases: [], domain: 'natwest.com' },
  { name: 'Halifax', aliases: [], domain: 'halifax.co.uk' },

  // Baltics
  { name: 'Luminor', aliases: [], domain: 'luminor.ee' },
  { name: 'LHV', aliases: [], domain: 'lhv.ee' },
  { name: 'Coop Pank', aliases: [], domain: 'cooppank.ee' },

  // Other
  { name: 'Raiffeisen Bank', aliases: ['raiffeisen'], domain: 'raiffeisen.at' },
  { name: 'Erste Bank', aliases: ['erste'], domain: 'erstebank.at' },
  { name: 'UniCredit', aliases: ['unicredit bank'], domain: 'unicredit.eu' },
  { name: 'KBC', aliases: [], domain: 'kbc.be' },
  { name: 'ABN AMRO', aliases: ['abn'], domain: 'abnamro.nl' },
  { name: 'Rabobank', aliases: [], domain: 'rabobank.nl' },
  { name: 'ING', aliases: [], domain: 'ing.com' },
];

const MATCH_THRESHOLD = 0.3;
const fuse = new Fuse(BANK_INSTITUTIONS, { keys: ['name', 'aliases'], threshold: MATCH_THRESHOLD, includeScore: true });

export function getConnectionBankName({ metadata }: { metadata: unknown }): string | null {
  const bankName = (metadata as Record<string, unknown> | null)?.bankName;
  return typeof bankName === 'string' ? bankName : null;
}

export function resolveBankLogoDomain({ bankName }: { bankName: string | null }): string | null {
  if (!bankName?.trim()) return null;

  const best = fuse.search(bankName)[0];
  if (!best || (best.score !== undefined && best.score > MATCH_THRESHOLD)) return null;

  return best.item.domain;
}
