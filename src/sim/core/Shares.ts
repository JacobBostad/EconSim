/**
 * Shares.ts — the single path every share trade goes through.
 *
 * Player commands (BUY_SHARES / SELL_SHARES) and AI stake purchases all call
 * tradeShares, so any market rule added here — fees, price impact, float
 * limits — applies to every participant identically. Shares trade against the
 * public float: cash moves to/from the world account, so total money supply
 * stays conserved.
 *
 * Price: 1% of a firm costs marketCap/100 — its operating valuation plus its
 * own stakes marked at the counterparties' operating valuations. Buying a
 * holding company therefore buys its portfolio, and because companyValuation
 * marks held stakes at the same number, buying at market leaves the buyer's
 * scoreboard valuation unchanged (cash out, an equal mark in).
 *
 * Cost basis: each stake's cumulative purchase cost is tracked in
 * firm.shareCostBasis, reduced pro-rata on sales, so sells report a realized
 * gain or loss against what was actually paid.
 */

import type { GameState } from './GameState';
import { recordTransaction, canAfford, emitEvent } from './GameState';
import { firmAccount, WORLD_ACCOUNT } from './Transactions';
import type { FirmId } from './Id';
import { marketCap } from '../selectors/companySelectors';
import { MAX_STAKE_PCT } from '../data/constants';
import { formatMoney } from '../../utils/formatMoney';

/** Current price of a 1% stake — marketCap/100, floored at one cent. */
export function sharePricePerPct(state: GameState, firmId: FirmId): number {
  return Math.max(1, Math.round(marketCap(state, firmId) / 100));
}

/**
 * Buy (positive pct) or sell (negative pct) a stake in another firm at the
 * current market price. Returns true when any percent actually traded.
 */
export function tradeShares(
  state: GameState,
  firmId: FirmId,
  targetFirmId: FirmId,
  pct: number,
): boolean {
  const firm = state.firms[firmId];
  const target = state.firms[targetFirmId];
  if (!firm || !target || firmId === targetFirmId || pct === 0) return false;
  if (target.ownerType !== 'player' && target.ownerType !== 'ai') return false;

  const held = firm.sharesHeld[targetFirmId] ?? 0;
  const wanted = Math.round(pct);
  const applied =
    wanted > 0
      ? Math.min(wanted, MAX_STAKE_PCT - held)
      : Math.max(wanted, -held);
  if (applied === 0) {
    emitEvent(state, 'warning', 'finance',
      wanted > 0
        ? `Cannot exceed a ${MAX_STAKE_PCT}% stake in ${target.name}.`
        : `No ${target.name} shares to sell.`,
      firmId);
    return false;
  }

  const pricePerPct = sharePricePerPct(state, targetFirmId);
  const cost = Math.abs(applied) * pricePerPct;

  if (applied > 0) {
    if (!canAfford(state, firmAccount(firmId), cost)) {
      emitEvent(state, 'danger', 'finance',
        `Not enough cash to buy ${applied}% of ${target.name} (${formatMoney(cost)}).`, firmId);
      return false;
    }
    recordTransaction(state, {
      from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: cost,
      firmId, category: 'shareBuy',
      note: `Bought ${applied}% of ${target.name}`,
    });
    firm.sharesHeld[targetFirmId] = held + applied;
    firm.shareCostBasis[targetFirmId] = (firm.shareCostBasis[targetFirmId] ?? 0) + cost;
    emitEvent(state, 'success', 'finance',
      `${firm.name} bought ${applied}% of ${target.name} for ${formatMoney(cost)}.`, targetFirmId);
  } else {
    recordTransaction(state, {
      from: WORLD_ACCOUNT, to: firmAccount(firmId), amount: cost,
      firmId, category: 'shareSell',
      note: `Sold ${-applied}% of ${target.name}`,
    });
    // Release cost basis pro-rata; report the realized result against it.
    const basis = firm.shareCostBasis[targetFirmId] ?? 0;
    const released = Math.round((basis * -applied) / held);
    const gain = cost - released;
    const remaining = held + applied;
    if (remaining <= 0) {
      delete firm.sharesHeld[targetFirmId];
      delete firm.shareCostBasis[targetFirmId];
    } else {
      firm.sharesHeld[targetFirmId] = remaining;
      firm.shareCostBasis[targetFirmId] = basis - released;
    }
    const result = gain >= 0
      ? `a ${formatMoney(gain)} gain`
      : `a ${formatMoney(-gain)} loss`;
    emitEvent(state, 'info', 'finance',
      `${firm.name} sold ${-applied}% of ${target.name} for ${formatMoney(cost)} — ${result} on cost.`, targetFirmId);
  }
  return true;
}
