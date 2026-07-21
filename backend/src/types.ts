export interface AppEnv extends Env {
  EMPLOYEE_DATA_KEY: string;
  EMPLOYEE_LOOKUP_KEY: string;
}

export type UserStatus = "PENDING_APPROVAL" | "ACTIVE" | "REJECTED" | "SUSPENDED" | "DISABLED";
export type UserRole = "USER" | "ADMIN";
export type RfqStatus = "DRAFT" | "VALIDATED" | "CANCELLED";
export type RfqDispatchStatus = "NOT_SENT" | "QUEUED" | "SENDING" | "WAITING" | "FAILED";
export type TargetField = "COUPON" | "PRICE" | "STRIKE" | "KO_BARRIER" | "KI_BARRIER";
export type MailBatchCode = "BMJB" | "NOMURA" | "UBS" | "DBS" | "SG" | "CITI" | "GS" | "CA";

export interface OutboundEmailJob {
  jobId: string;
  batchId: string;
  rfqId: string;
}

export interface InboundEmailJob {
  jobId: string;
  inboundMessageId: string;
}

export interface QuoteNormalizeJob {
  jobId: string;
  inboundMessageId: string;
  rfqId: string;
  issuer: "BNP" | "MS" | "JPM" | "BARCLAYS" | "NOMURA" | "UBS" | "DBS" | "SG" | "CITI" | "GS" | "CA";
}

export type FinalizationTrigger = "ALL_TERMINAL" | "DEADLINE" | "RECALCULATION";

export interface QuoteRankJob {
  jobId: string;
  rfqId: string;
  trigger: FinalizationTrigger;
  requestedVersion: number;
}

export interface ImageRenderJob {
  jobId: string;
  artifactId: string;
  rfqId: string;
  rankingRunId: string;
  issuer: string;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  branchName: string;
  role: UserRole;
  credentialVersion: number;
}

export interface SessionContext {
  id: string;
  csrfTokenHash: string;
  absoluteExpiresAt: string;
  user: AuthenticatedUser;
}

export interface NormalizedTrade {
  sequence: number;
  tradeCode: string;
  product: "FCN" | "DAC";
  currency: string;
  tradeDate: string;
  effectiveDateOffsetCalendarDays: 7;
  tenorMonths: number;
  guaranteedPeriodsMonths: number;
  underlyings: string[];
  strikePct: number | null;
  koType: "Daily" | "Daily Memory" | "Period End" | "Period End Memory";
  koBarrierPct: number | null;
  couponPaPct: number | null;
  upfrontOrNotePricePct: number | null;
  barrierType: "EKI" | "AKI" | "NONE";
  kiBarrierPct: number | null;
  observationFrequencyMonths: 1;
  otc: "Note";
  targetField: TargetField;
  matchingKeyHash: string;
}
