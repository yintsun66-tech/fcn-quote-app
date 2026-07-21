export interface AppEnv extends Env {
  EMPLOYEE_DATA_KEY: string;
  EMPLOYEE_LOOKUP_KEY: string;
}

export type UserStatus = "PENDING_APPROVAL" | "ACTIVE" | "REJECTED" | "SUSPENDED" | "DISABLED";
export type UserRole = "USER" | "ADMIN";
export type RfqStatus = "DRAFT" | "VALIDATED" | "CANCELLED";
export type TargetField = "COUPON" | "PRICE" | "STRIKE" | "KO_BARRIER" | "KI_BARRIER";

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
