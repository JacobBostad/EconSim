/**
 * Acquisition.ts — full-takeover mechanics, shared by the player's
 * ACQUIRE_FIRM command and AI-initiated rescue consolidation.
 *
 * The buyer pays a premium on valuation (discount for distressed targets,
 * reduced by any stake already held), then absorbs everything: cash, debt,
 * facilities, employees, in-flight shipments, contracts, brand/quality/prices,
 * and remaining share stakes. The target firm ceases to exist.
 *
 * Fair takeovers (Phase 3, docs/design/stock-market.md): every OUTSIDE firm
 * holding shares of the target is cashed out at the same per-share price the
 * acquisition implies (val × premium ÷ 100), firm-to-firm, releasing its cost
 * basis with a realized-P&L event exactly like an open-market sell — only the
 * unheld public float leaks to the world account. The target's own stakes move
 * to the buyer (excess over the partial cap, and the target's stake in the
 * buyer itself, sold at market rather than clipped or deleted). Money is
 * conserved throughout — every movement is one recordTransaction.
 *
 * Control ladder (Phase 3): a single outside firm holding CONTROL_BLOCK_PCT or
 * more of the target vetoes a hostile full acquisition by anyone else.
 */

import type { GameState } from './GameState';
import { formatMoney } from '../../utils/formatMoney';
import { canAfford, emitEvent, recordTransaction } from './GameState';
import { townOf } from './Town';
import { firmAccount, WORLD_ACCOUNT } from './Transactions';
import type { FirmId } from './Id';
import {
  ACQUISITION_PREMIUM_HEALTHY,
  ACQUISITION_PREMIUM_DISTRESSED,
  MAX_STAKE_PCT,
  CONTROL_BLOCK_PCT,
} from '../data/constants';
import { marketCap } from '../selectors/companySelectors';
import { tradeShares } from './Shares';

/** Premium multiple applied to a target's marketCap for a full takeover. */
function acquisitionPremium(state: GameState, targetId: FirmId): number {
  // Home-town view (identity in a one-town region, so the returned record is the
  // same reference); gains a `townId` param at the endgame move.
  return townOf(state).firms[targetId]?.bankruptcyStatus === 'healthy'
    ? ACQUISITION_PREMIUM_HEALTHY
    : ACQUISITION_PREMIUM_DISTRESSED;
}

/** Price to buy the target outright right now (net of shares already held).
 * Priced off marketCap — the same number 1% trades at ×100 — so a creeping
 * acquisition and a clean takeover value the firm identically. */
export function acquisitionCost(state: GameState, buyerId: FirmId, targetId: FirmId): number {
  const firms = townOf(state).firms;
  const target = firms[targetId];
  const buyer = firms[buyerId];
  if (!target || !buyer) return 0;
  const val = marketCap(state, targetId);
  const premium = acquisitionPremium(state, targetId);
  const heldPct = buyer.sharesHeld[targetId] ?? 0;
  return Math.max(1, Math.round((val * premium * (100 - heldPct)) / 100));
}

/**
 * Whether a hostile full acquisition of `targetId` by `buyerId` is blocked by
 * an outside firm's controlling stake. A single firm (not the buyer) holding
 * CONTROL_BLOCK_PCT or more has a takeover veto — AI never consents, so the
 * stake is protection. The buyer's own stake never blocks its own bid.
 * Returns the blocking firm's id, or null if the path is clear.
 */
export function acquisitionBlocker(
  state: GameState,
  buyerId: FirmId,
  targetId: FirmId,
): FirmId | null {
  const firms = townOf(state).firms;
  for (const hid of Object.keys(firms).sort()) {
    if (hid === buyerId) continue;
    if ((firms[hid]!.sharesHeld[targetId] ?? 0) >= CONTROL_BLOCK_PCT) return hid;
  }
  return null;
}

/** Execute a full takeover. Returns true on success. Only AI targets. */
export function performAcquisition(
  state: GameState,
  buyerId: FirmId,
  targetId: FirmId,
): boolean {
  const s = state;
  const firms = townOf(s).firms;
  const buyer = firms[buyerId];
  const target = firms[targetId];
  if (!buyer || !target || buyerId === targetId) return false;
  if (target.ownerType !== 'ai') return false;
  if (buyer.ownerType !== 'player' && buyer.ownerType !== 'ai') return false;

  // Takeover protection: a controlling outside stake vetoes the bid.
  const blockerId = acquisitionBlocker(s, buyerId, targetId);
  if (blockerId) {
    if (buyer.ownerType === 'player') {
      const blocker = firms[blockerId]!;
      emitEvent(s, 'warning', 'finance',
        `${blocker.name} holds a blocking ${blocker.sharesHeld[targetId]}% of ${target.name} — its board rejects the takeover.`,
        buyer.id);
    }
    return false;
  }

  // Price the whole firm off its marketCap, net of the buyer's own stake.
  const val = marketCap(s, targetId);
  const premium = acquisitionPremium(s, targetId);
  const heldPct = buyer.sharesHeld[targetId] ?? 0;
  const cost = Math.max(1, Math.round((val * premium * (100 - heldPct)) / 100));
  if (!canAfford(s, firmAccount(buyer.id), cost)) {
    if (buyer.ownerType === 'player') {
      emitEvent(s, 'danger', 'finance',
        `Not enough cash to acquire ${target.name} (needs ${formatMoney(cost)}).`, buyer.id);
    }
    return false;
  }

  // Cash out the outside shareholders at the acquisition's per-share price,
  // firm-to-firm and in sorted order, releasing each holder's cost basis with a
  // realized-P&L event (as an open-market sell would). The buyer's total outlay
  // is exactly `cost`: whatever the held stakes don't absorb is the public
  // float's share and leaks to the world. Rounding is clamped to the remaining
  // budget so the sum can never mint or burn a cent.
  let remaining = cost;
  for (const hid of Object.keys(firms).sort()) {
    if (hid === buyerId) continue;
    const holder = firms[hid]!;
    const pct = holder.sharesHeld[targetId] ?? 0;
    if (pct <= 0) continue;
    const pay = Math.min(remaining, Math.round((val * premium * pct) / 100));
    if (pay > 0) {
      recordTransaction(s, {
        from: firmAccount(buyer.id), to: firmAccount(hid), amount: pay,
        firmId: buyer.id, category: 'shareBuy',
        counterparty: { firmId: hid, category: 'shareSell' },
        note: `Bought out ${holder.name}'s ${pct}% of ${target.name}`,
      });
      remaining -= pay;
    }
    const basis = holder.shareCostBasis[targetId] ?? 0;
    const gain = pay - basis;
    delete holder.sharesHeld[targetId];
    delete holder.shareCostBasis[targetId];
    const result = gain >= 0 ? `a ${formatMoney(gain)} gain` : `a ${formatMoney(-gain)} loss`;
    emitEvent(s, 'info', 'finance',
      `${holder.name} was cashed out of its ${pct}% stake in ${target.name} for ${formatMoney(pay)} — ${result} on cost.`,
      hid);
  }
  // The unheld public float leaves to the outside world (never negative).
  if (remaining > 0) {
    recordTransaction(s, {
      from: firmAccount(buyer.id), to: WORLD_ACCOUNT, amount: remaining,
      firmId: buyer.id, category: 'shareBuy', note: `Acquired ${target.name} (public float)`,
    });
  }
  // The buyer's own pre-held stake is consumed by the takeover (already netted
  // out of the price); retire it without a further payment.
  delete buyer.sharesHeld[targetId];
  delete buyer.shareCostBasis[targetId];

  // Move the target's own stakes to the buyer BEFORE absorbing its cash, so any
  // market proceeds land in the estate the buyer inherits. Snapshot the keys —
  // tradeShares mutates target.sharesHeld as it settles.
  for (const tid of Object.keys(target.sharesHeld).sort()) {
    const pct = target.sharesHeld[tid] ?? 0;
    if (pct <= 0) continue;
    if (tid === buyer.id) {
      // A firm can't hold its own equity: sell the target's stake in the buyer
      // at market into the target's estate rather than deleting it.
      tradeShares(s, target.id, buyer.id, -pct);
      continue;
    }
    // Inherit the stake and its basis; anything above the partial cap is sold
    // at market rather than silently clipped.
    const combined = (buyer.sharesHeld[tid] ?? 0) + pct;
    buyer.sharesHeld[tid] = combined;
    buyer.shareCostBasis[tid] =
      (buyer.shareCostBasis[tid] ?? 0) + (target.shareCostBasis[tid] ?? 0);
    if (combined > MAX_STAKE_PCT) {
      tradeShares(s, buyer.id, tid, -(combined - MAX_STAKE_PCT));
    }
  }

  // Absorb the target's cash position (positive or negative).
  if (target.cash > 0) {
    recordTransaction(s, {
      from: firmAccount(target.id), to: firmAccount(buyer.id), amount: target.cash,
      firmId: null, category: 'none', note: `Cash of acquired ${target.name}`,
    });
  } else if (target.cash < 0) {
    recordTransaction(s, {
      from: firmAccount(buyer.id), to: firmAccount(target.id), amount: -target.cash,
      firmId: null, category: 'none', note: `Covered debts of acquired ${target.name}`,
    });
  }
  buyer.debt += target.debt;

  // Facilities, staff, shipments, contracts.
  for (const facId of target.facilities) {
    const fac = s.facilities[facId];
    if (!fac) continue;
    fac.ownerFirmId = buyer.id;
    buyer.facilities.push(facId);
  }
  const citizens = townOf(s).citizens;
  for (const cid of target.employees) {
    const cit = citizens[cid];
    if (!cit) continue;
    cit.employerFirmId = buyer.id;
    buyer.employees.push(cid);
  }
  for (const vid in s.vehicles) {
    if (s.vehicles[vid]!.ownerFirmId === target.id) s.vehicles[vid]!.ownerFirmId = buyer.id;
  }
  for (const ctrId in s.contracts) {
    if (s.contracts[ctrId]!.ownerFirmId === target.id) s.contracts[ctrId]!.ownerFirmId = buyer.id;
  }

  // Merge product state: keep the better brand/quality; adopt missing prices.
  for (const pid in target.brandByProduct) {
    buyer.brandByProduct[pid] = Math.max(buyer.brandByProduct[pid] ?? 0, target.brandByProduct[pid]!);
  }
  for (const pid in target.qualityByProduct) {
    buyer.qualityByProduct[pid] = Math.max(buyer.qualityByProduct[pid] ?? 0, target.qualityByProduct[pid]!);
  }
  for (const pid in target.pricesByProduct) {
    if (!buyer.pricesByProduct[pid]) buyer.pricesByProduct[pid] = target.pricesByProduct[pid]!;
  }
  for (const pid in target.adBudgetByProduct) {
    if (!buyer.adBudgetByProduct[pid]) buyer.adBudgetByProduct[pid] = target.adBudgetByProduct[pid]!;
  }

  // Any remaining outside stakes IN the target are stale once it's gone; the
  // cash-out loop above already cleared every holder, so just drop the firm.
  buyer.acquiredNames.push(target.name);
  delete s.firms[targetId];
  emitEvent(s, buyer.ownerType === 'player' ? 'success' : 'warning', 'finance',
    `🤝 ${buyer.name} acquired ${target.name} for ${formatMoney(cost)} — facilities, staff, and brands absorbed.`,
    buyer.id);
  return true;
}
