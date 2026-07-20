/**
 * Acquisition.ts — full-takeover mechanics, shared by the player's
 * ACQUIRE_FIRM command and AI-initiated rescue consolidation.
 *
 * The buyer pays a premium on valuation (discount for distressed targets,
 * reduced by any stake already held) to the outside shareholders (world
 * account), then absorbs everything: cash, debt, facilities, employees,
 * in-flight shipments, contracts, brand/quality/prices, and remaining share
 * stakes. The target firm ceases to exist. Money is conserved throughout.
 */

import type { GameState } from './GameState';
import { formatMoney } from '../../utils/formatMoney';
import { canAfford, emitEvent, recordTransaction } from './GameState';
import { firmAccount, WORLD_ACCOUNT } from './Transactions';
import type { FirmId } from './Id';
import {
  ACQUISITION_PREMIUM_HEALTHY,
  ACQUISITION_PREMIUM_DISTRESSED,
  MAX_STAKE_PCT,
} from '../data/constants';
import { marketCap } from '../selectors/companySelectors';

/** Price to buy the target outright right now (net of shares already held).
 * Priced off marketCap — the same number 1% trades at ×100 — so a creeping
 * acquisition and a clean takeover value the firm identically. */
export function acquisitionCost(state: GameState, buyerId: FirmId, targetId: FirmId): number {
  const target = state.firms[targetId];
  const buyer = state.firms[buyerId];
  if (!target || !buyer) return 0;
  const val = marketCap(state, targetId);
  const premium =
    target.bankruptcyStatus === 'healthy'
      ? ACQUISITION_PREMIUM_HEALTHY
      : ACQUISITION_PREMIUM_DISTRESSED;
  const heldPct = buyer.sharesHeld[targetId] ?? 0;
  return Math.max(1, Math.round((val * premium * (100 - heldPct)) / 100));
}

/** Execute a full takeover. Returns true on success. Only AI targets. */
export function performAcquisition(
  state: GameState,
  buyerId: FirmId,
  targetId: FirmId,
): boolean {
  const s = state;
  const buyer = s.firms[buyerId];
  const target = s.firms[targetId];
  if (!buyer || !target || buyerId === targetId) return false;
  if (target.ownerType !== 'ai') return false;
  if (buyer.ownerType !== 'player' && buyer.ownerType !== 'ai') return false;

  const cost = acquisitionCost(s, buyerId, targetId);
  if (!canAfford(s, firmAccount(buyer.id), cost)) {
    if (buyer.ownerType === 'player') {
      emitEvent(s, 'danger', 'finance',
        `Not enough cash to acquire ${target.name} (needs ${formatMoney(cost)}).`, buyer.id);
    }
    return false;
  }

  // Pay the outside shareholders.
  recordTransaction(s, {
    from: firmAccount(buyer.id), to: WORLD_ACCOUNT, amount: cost,
    firmId: null, category: 'none', note: `Acquired ${target.name}`,
  });

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
  for (const cid of target.employees) {
    const cit = s.citizens[cid];
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

  // Share bookkeeping: stakes IN the target vanish (bought out); the target's
  // own stakes transfer to the buyer along with their cost basis.
  for (const hid in s.firms) {
    delete s.firms[hid]!.sharesHeld[targetId];
    delete s.firms[hid]!.shareCostBasis[targetId];
  }
  for (const tid in target.sharesHeld) {
    if (tid === buyer.id) continue;
    buyer.sharesHeld[tid] = Math.min(
      MAX_STAKE_PCT,
      (buyer.sharesHeld[tid] ?? 0) + target.sharesHeld[tid]!,
    );
    buyer.shareCostBasis[tid] =
      (buyer.shareCostBasis[tid] ?? 0) + (target.shareCostBasis[tid] ?? 0);
  }

  buyer.acquiredNames.push(target.name);
  delete s.firms[targetId];
  emitEvent(s, buyer.ownerType === 'player' ? 'success' : 'warning', 'finance',
    `🤝 ${buyer.name} acquired ${target.name} for ${formatMoney(cost)} — facilities, staff, and brands absorbed.`,
    buyer.id);
  return true;
}
