/**
 * formatMoney — display helpers. Internally money is integer cents; these
 * convert to human-readable dollar strings.
 */

import { CENTS } from '../sim/data/constants';

export function formatMoney(cents: number): string {
  const dollars = cents / CENTS;
  const sign = dollars < 0 ? '-' : '';
  const abs = Math.abs(dollars);
  return `${sign}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Compact form for large numbers, e.g. $12.3k, $1.2M. */
export function formatMoneyShort(cents: number): string {
  const dollars = cents / CENTS;
  const sign = dollars < 0 ? '-' : '';
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}
