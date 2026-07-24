/**
 * interestRates — risk-tiered loan pricing (docs/design/interest-rates.md).
 *
 * A loan's all-in rate is priced like a real economy: a low "prime" base on the
 * first dollar plus a spread that rises with the firm's leverage. Leverage is
 * measured against the SAME liquid net worth the credit limit prices against —
 * `loanNetWorth` below (cash + inventory at base prices) is the one shared
 * basis, called by both `Simulation.takeLoan`'s limit and this formula, so the
 * two can never drift apart. The first bridge dollar reads like inflation + a
 * bank margin + baseline risk (~11%/yr); the spread saturates at leverage 1.5
 * (the credit-limit multiple) where it returns exactly the old flat ceiling
 * (~33%/yr). Note the honest dynamics: leverage is debt over CURRENT liquid
 * worth, so a firm still holding its borrowed cash sits below the draw-time
 * ratio, and one that spent the whole maxed line into buildings pays the full
 * ceiling — encumbrance, not the draw, is what the spread prices.
 *
 *   leverage      = debt / max(loanNetWorth, MIN_NET_WORTH)        // 0 unlevered
 *   effectiveRate = BASE_RATE + SPREAD_SLOPE × clamp(leverage, 0, LEVERAGE_CAP)
 *
 * Behind config flag `riskTieredInterestEnabled`. With the flag OFF the charged
 * rate is the stored flat per-firm `interestRatePerDay`, byte-identical to the
 * pre-formula behavior — so every pin and fixture is untouched (no firm on the
 * pinned paths ever borrows, so the rate is read zero times there anyway).
 */

import type { GameState } from '../core/GameState';
import type { Firm } from '../entities/Firm';
import type { FirmId } from '../core/Id';
import { townOf } from '../core/Town';
import { getProduct } from '../data/products';
import { LOAN_CREDIT_LIMIT_MULTIPLE, LOAN_MIN_CREDIT } from '../data/constants';
import { clamp } from '../../utils/clamp';

/** Prime — the rate on the first (unlevered) dollar. ≈ 11%/yr. */
export const BASE_RATE = 0.0003;
/** Spread added per unit of leverage. Tuned so the all-in rate returns to the
 *  old flat 0.0009 (≈ 33%/yr) exactly at the credit-limit leverage. */
export const SPREAD_SLOPE = 0.0004;
/** Leverage at which the spread saturates — equals the credit-limit multiple,
 *  so the rate never over-punishes past the point borrowing is cut off. */
export const LEVERAGE_CAP = LOAN_CREDIT_LIMIT_MULTIPLE; // 1.5
/** Floor for the leverage DENOMINATOR (a divide-by-zero guard: a near-zero
 *  net-worth firm is priced as if it held this much). Reuses the credit line's
 *  LOAN_MIN_CREDIT constant, but note the different role — there it floors the
 *  minimum BORROWABLE amount, here the pricing basis. */
export const MIN_NET_WORTH = LOAN_MIN_CREDIT; // dollars(5000)

/**
 * The liquid net worth loans are priced against: cash + inventory at base
 * prices. This is THE shared collateral basis — `Simulation.takeLoan`'s credit
 * limit delegates here, and the tiered rate below divides by it, so the
 * formula's saturation at LEVERAGE_CAP provably aligns with the limit's
 * multiple on the same numbers. (Fixed assets and the equity book are
 * deliberately excluded, exactly as the credit limit always has.)
 */
export function loanNetWorth(state: GameState, firmId: FirmId): number {
  const firm = townOf(state).firms[firmId];
  if (!firm) return 0;
  let inv = 0;
  for (const facId of firm.facilities) {
    const fac = townOf(state).facilities[facId];
    if (!fac) continue;
    for (const bag of [fac.inputInventory, fac.outputInventory]) {
      for (const pid in bag) inv += bag[pid]!.quantity * getProduct(pid).basePrice;
    }
  }
  return firm.cash + inv;
}

/**
 * Leverage = debt ÷ max(liquidNetWorth, MIN_NET_WORTH), clamped to
 * [0, LEVERAGE_CAP]. Zero when the firm carries no debt.
 */
export function firmLeverage(debt: number, liquidNetWorth: number): number {
  if (debt <= 0) return 0;
  return clamp(debt / Math.max(liquidNetWorth, MIN_NET_WORTH), 0, LEVERAGE_CAP);
}

/** The tiered rate for a given leverage: BASE_RATE + SPREAD_SLOPE × clamp(lev). */
export function effectiveRateForLeverage(leverage: number): number {
  return BASE_RATE + SPREAD_SLOPE * clamp(leverage, 0, LEVERAGE_CAP);
}

/**
 * The tiered effective rate a firm's current outstanding debt accrues at, given
 * its current leverage — measured on `loanNetWorth`, the same liquid basis the
 * credit limit prices against (shared code, so the coupling cannot drift).
 */
export function effectiveInterestRatePerDay(firm: Firm, state: GameState): number {
  return effectiveRateForLeverage(firmLeverage(firm.debt, loanNetWorth(state, firm.id)));
}

/**
 * The rate a hypothetical debt level would bear at the firm's current
 * operating net worth — used by the borrow buttons to show what the next dollar
 * costs.
 */
export function effectiveRateForDebt(debt: number, liquidNetWorth: number): number {
  return effectiveRateForLeverage(firmLeverage(debt, liquidNetWorth));
}

/**
 * The rate FinanceSystem actually charges. Flag ON → the tiered effective rate;
 * flag OFF → the stored flat per-firm rate, byte-identical to pre-formula. This
 * is the single source of truth shared by the sim and every UI surface, so the
 * displayed rate always equals the charged rate.
 */
export function chargedInterestRatePerDay(firm: Firm, state: GameState): number {
  return state.config.riskTieredInterestEnabled
    ? effectiveInterestRatePerDay(firm, state)
    : firm.interestRatePerDay;
}

/** Convert a per-day rate to an annual simple percentage (rate × 365 × 100). */
export function annualRatePercent(perDay: number): number {
  return perDay * 365 * 100;
}
