import type { TargetField } from "./types";

export interface QuoteRankRow {
  id: string;
  trade_id: string | null;
  issuer: string;
  status: string;
  received_at: string;
  strike_pct: number | null;
  ko_barrier_pct: number | null;
  coupon_pa_pct: number | null;
  comparable_price_pct: number | null;
  ki_barrier_pct: number | null;
  rejection_reason?: string | null;
}

export interface RankedQuote {
  quote: QuoteRankRow;
  economicRank: number;
  displayOrder: number;
  value: number;
  tieGroup: string;
}

export interface RankOptions {
  includeLateReplies?: boolean;
  maxEconomicRank?: number;
}

export function rankingDirection(field: TargetField): "ASC" | "DESC" {
  return field === "COUPON" ? "DESC" : "ASC";
}

export function quoteTargetValue(quote: QuoteRankRow, field: TargetField): number | null {
  if (field === "COUPON") return quote.coupon_pa_pct;
  if (field === "PRICE") return quote.comparable_price_pct;
  if (field === "STRIKE") return quote.strike_pct;
  if (field === "KO_BARRIER") return quote.ko_barrier_pct;
  return quote.ki_barrier_pct;
}

export function isQuoteRankEligible(quote: QuoteRankRow, field: TargetField, options: RankOptions = {}): boolean {
  const statusEligible = quote.status === "VALID"
    || (options.includeLateReplies === true && quote.status === "LATE_REPLY" && !quote.rejection_reason);
  const value = quoteTargetValue(quote, field);
  return statusEligible && value !== null && Number.isFinite(value);
}

export function rankValidQuotes(
  quotes: QuoteRankRow[],
  field: TargetField,
  options: RankOptions = {}
): RankedQuote[] {
  const sortable = quotes.flatMap(quote => {
    const value = quoteTargetValue(quote, field);
    return isQuoteRankEligible(quote, field, options) && value !== null ? [{ quote, value }] : [];
  });
  const multiplier = rankingDirection(field) === "ASC" ? 1 : -1;
  sortable.sort((left, right) => {
    const economic = multiplier * (left.value - right.value);
    if (Math.abs(economic) > 1e-9) return economic;
    return left.quote.received_at.localeCompare(right.quote.received_at) || left.quote.id.localeCompare(right.quote.id);
  });
  const maxEconomicRank = options.maxEconomicRank ?? 5;
  let economicRank = 0;
  let previous: number | null = null;
  return sortable.flatMap((entry, index) => {
    if (previous === null || Math.abs(entry.value - previous) > 1e-9) economicRank += 1;
    previous = entry.value;
    if (economicRank > maxEconomicRank) return [];
    return [{
      quote: entry.quote,
      economicRank,
      displayOrder: index + 1,
      value: entry.value,
      tieGroup: `${field}:${entry.value.toFixed(8)}`
    }];
  });
}

export function customFifthCandidates(rankedQuotes: RankedQuote[]): RankedQuote[] {
  const topFourIssuers = new Set(
    rankedQuotes.filter(result => result.economicRank <= 4).map(result => result.quote.issuer)
  );
  const selectedIssuers = new Set<string>();
  return rankedQuotes.filter(result => {
    const issuer = result.quote.issuer;
    if (topFourIssuers.has(issuer) || selectedIssuers.has(issuer)) return false;
    selectedIssuers.add(issuer);
    return true;
  });
}
