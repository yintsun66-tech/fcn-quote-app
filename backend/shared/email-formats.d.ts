export interface MailTradeRecord {
  product: string;
  currency: string;
  guaranteedPeriods: string;
  bbgCode1: string;
  bbgCode2: string;
  bbgCode3: string;
  bbgCode4: string;
  bbgCode5: string;
  strike: string;
  koType: string;
  koBarrier: string;
  coupon: string;
  upfront: string;
  tenor: string;
  barrierType: string;
  kiBarrier: string;
  observationFrequency: string;
  otc: string;
  effectiveDateOffset: string;
  tradeDate: string;
}

export interface InstitutionEmail {
  key: string;
  label: string;
  subject: string;
  html: string;
  plainText: string;
}

export const MAIL_INSTITUTION_ORDER: readonly string[];
export const EMAIL_INSTITUTIONS: Readonly<Record<string, {
  label: string;
  subject: string;
  columns: readonly { label: string; value(record: MailTradeRecord): string }[];
}>>;

export function buildEmailBody(columns: readonly { label: string }[], dataRows: readonly (readonly string[])[]): string;
export function buildEmailHtml(columns: readonly { label: string }[], dataRows: readonly (readonly string[])[]): string;
export function buildCorrelatedSubject(baseSubject: string, rfqToken: string, batchCode: string): string;
export function buildInstitutionEmail(
  key: string,
  records: readonly MailTradeRecord[],
  correlation?: { rfqToken: string; batchCode?: string },
): InstitutionEmail;
