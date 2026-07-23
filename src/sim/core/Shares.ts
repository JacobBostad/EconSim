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
import { townOf } from './Town';
import {
  MAX_STAKE_PCT,
  SHARE_TRADE_FEE,
  SHARE_PRICE_IMPACT_PER_PCT,
  SHARE_SHIFT_MAX,
} from '../data/constants';
import { formatMoney } from '../../utils/formatMoney';

/**
 * Current quote for a 1% stake: fair value (marketCap) displaced by recent
 * trading. The displacement (state.sharePriceShift) is a liquidity
 * phenomenon — valuation marks always use the undisplaced marketCap.
 */
export function sharePricePerPct(state: GameState, firmId: FirmId): number {
  const shift = state.sharePriceShift[firmId] ?? 0;
  return Math.max(1, Math.round((marketCap(state, firmId) * (1 + shift)) / 100));
}

/**
 * Fill price for trading `pct` percent in direction `dir` (+1 buy, −1 sell):
 * the order walks half its own impact, exactly like the commodity desk's
 * impactedFillPrice — so a round trip pays the full spread it creates.
 */
function fillPricePerPct(state: GameState, firmId: FirmId, pct: number, dir: 1 | -1): number {
  const shift = state.sharePriceShift[firmId] ?? 0;
  const fillMult = 1 + shift + (dir * pct * SHARE_PRICE_IMPACT_PER_PCT) / 2;
  return Math.max(1, Math.round((marketCap(state, firmId) * fillMult) / 100));
}

/** Push the resting quote after a trade, clamped to the displacement band. */
function applyShareImpact(state: GameState, firmId: FirmId, pct: number, dir: 1 | -1): void {
  const next = (state.sharePriceShift[firmId] ?? 0) + dir * pct * SHARE_PRICE_IMPACT_PER_PCT;
  const clamped = Math.max(-SHARE_SHIFT_MAX, Math.min(SHARE_SHIFT_MAX, next));
  if (clamped === 0) delete state.sharePriceShift[firmId];
  else state.sharePriceShift[firmId] = clamped;
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
  // Home-town view (identity in a one-town region, so the returned record is the
  // same reference); gains a `townId` param at the endgame move.
  const firms = townOf(state).firms;
  const firm = firms[firmId];
  const target = firms[targetFirmId];
  if (!firm || !target || firmId === targetFirmId || pct === 0) return false;
  if (target.ownerType !== 'player' && target.ownerType !== 'ai') return false;

  const held = firm.sharesHeld[targetFirmId] ?? 0;
  const wanted = Math.round(pct);
  let applied =
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

  // Float ledger (Arc B2, city-scale only): there is one company to own, so the
  // aggregate of EVERY firm's stake in a target can never exceed 100%. B1's
  // review flagged that nothing enforced this — three outside 49% holders summed
  // to 147%. First-come priority: a late buyer is clamped to the remaining
  // float. Village keeps its grandfathered (looser) behavior for the bit-
  // identity contract — and with 25% AI caps its aggregate never nears 100
  // anyway; the new city yield-buying is the only pressure toward full float.
  if (state.config.sizePreset !== 'village' && applied > 0) {
    let outstanding = 0;
    for (const hid of Object.keys(firms).sort()) {
      outstanding += firms[hid]!.sharesHeld[targetFirmId] ?? 0;
    }
    applied = Math.min(applied, Math.max(0, 100 - outstanding));
    if (applied === 0) {
      emitEvent(state, 'warning', 'finance',
        `${target.name} has no public float left to buy.`, firmId);
      return false;
    }
  }

  const size = Math.abs(applied);
  const dir: 1 | -1 = applied > 0 ? 1 : -1;
  const notional = size * fillPricePerPct(state, targetFirmId, size, dir);
  const fee = Math.round(notional * SHARE_TRADE_FEE);

  if (applied > 0) {
    const cost = notional + fee;
    if (!canAfford(state, firmAccount(firmId), cost)) {
      emitEvent(state, 'danger', 'finance',
        `Not enough cash to buy ${applied}% of ${target.name} (${formatMoney(cost)} incl. fees).`, firmId);
      return false;
    }
    recordTransaction(state, {
      from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: cost,
      firmId, category: 'shareBuy',
      note: `Bought ${applied}% of ${target.name} (${formatMoney(fee)} fees)`,
    });
    firm.sharesHeld[targetFirmId] = held + applied;
    firm.shareCostBasis[targetFirmId] = (firm.shareCostBasis[targetFirmId] ?? 0) + cost;
    applyShareImpact(state, targetFirmId, size, 1);
    emitEvent(state, 'success', 'finance',
      `${firm.name} bought ${applied}% of ${target.name} for ${formatMoney(cost)}.`, targetFirmId);
  } else {
    const cost = Math.max(0, notional - fee);
    recordTransaction(state, {
      from: WORLD_ACCOUNT, to: firmAccount(firmId), amount: cost,
      firmId, category: 'shareSell',
      note: `Sold ${-applied}% of ${target.name} (${formatMoney(fee)} fees)`,
    });
    applyShareImpact(state, targetFirmId, size, -1);
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
