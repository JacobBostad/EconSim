/**
 * Demolition.ts — selling a facility back to the land.
 *
 * Without this, a misplaced building is a permanent maintenance drain and
 * mistakes are unrecoverable. Selling refunds half the recorded build cost
 * (paid by the world account — money stays conserved), releases the crew back
 * into the labor pool, and removes every reference to the facility: supply
 * contracts, in-transit vehicles, and the building itself. Stored goods (and
 * cargo on the seller's vehicles bound to/from it) are salvaged back to the
 * seller at the wholesale discount instead of being written off.
 */

import type { GameState } from './GameState';
import { formatMoney } from '../../utils/formatMoney';
import { recordTransaction, emitEvent } from './GameState';
import { firmAccount, WORLD_ACCOUNT } from './Transactions';
import type { FirmId, FacilityId } from './Id';
import { getProduct } from '../data/products';
import { WHOLESALE_DISCOUNT } from '../data/constants';
import { fireCitizen } from '../systems/LaborSystem';
import { townOf } from './Town';

/** Fraction of the recorded build cost refunded on sale. */
export const SELL_REFUND_RATE = 0.5;

/**
 * Fraction of a stored good's base price salvaged when its facility is sold —
 * the same wholesale haircut a local surplus sells at (WHOLESALE_DISCOUNT),
 * so liquidating stock through a sale is neither a mint nor a total write-off.
 */
export const SALVAGE_RATE = WHOLESALE_DISCOUNT;

/** Facility types that can never be sold (not a business asset). */
const UNSELLABLE_TYPES = new Set(['importer']);

/**
 * Book value recovered on sale: base build cost plus any upgrade capex sunk in
 * (Phase 5). Upgrade capex is city-only and absent in a Village, so this equals
 * plain buildCost there — the classic refund is byte-identical.
 */
export function facilityBookValue(fac: { buildCost: number; upgradeCapex?: number }): number {
  return fac.buildCost + (fac.upgradeCapex ?? 0);
}

/** Refund a sale would pay, or null if this facility cannot be sold. */
export function sellRefund(state: GameState, firmId: FirmId, facilityId: FacilityId): number | null {
  // Home-town view (identity in a one-town region, so the returned record is the
  // same reference); gains a `townId` param at the endgame move.
  const fac = townOf(state).facilities[facilityId];
  const firm = townOf(state).firms[firmId];
  if (!fac || !firm) return null;
  if (fac.ownerFirmId !== firmId) return null;
  if (UNSELLABLE_TYPES.has(fac.type)) return null;
  // A leased premises isn't the operator's to sell — the landlord carries the
  // asset (HD4). The operator can walk away, but there's no refund to it.
  if (fac.landlordFirmId !== undefined) return null;
  return Math.floor(facilityBookValue(fac) * SELL_REFUND_RATE);
}

/** Sell an owned facility. Returns true on success. */
export function sellFacility(state: GameState, firmId: FirmId, facilityId: FacilityId): boolean {
  const refund = sellRefund(state, firmId, facilityId);
  if (refund === null) return false;
  const fac = townOf(state).facilities[facilityId]!;
  const firm = townOf(state).firms[firmId]!;

  // Crew back to the labor pool (fireCitizen also cleans both employee lists).
  for (const cid of [...fac.employees]) fireCitizen(state, facilityId, cid);

  // Supply contracts touching this facility are void — except other firms'
  // wholesale contracts that merely SOURCED here: those are their property,
  // so they fall back to the importer instead of vanishing (deleting them
  // would silently sever an AI chain's input line forever).
  const importer = Object.values(townOf(state).facilities).find((f) => f.type === 'importer');
  for (const cid in state.contracts) {
    const c = state.contracts[cid]!;
    if (c.destinationFacilityId === facilityId) {
      delete state.contracts[cid];
    } else if (c.sourceFacilityId === facilityId) {
      if (c.ownerFirmId !== firmId && importer) {
        c.sourceFacilityId = importer.id;
      } else {
        delete state.contracts[cid];
      }
    }
  }

  // Salvage the goods rather than stranding them: stored inventory plus the
  // cargo on the seller's own vehicles bound to/from the facility (those
  // vehicles have nowhere left to go, so they're removed). Each unit fetches
  // the wholesale haircut on its base price — the same discount a local surplus
  // clears at — so the sale liquidates stock instead of vaporizing it. Units,
  // not value, drive the number, so it's conserved (paid by the world account).
  let salvageUnits = 0;
  let salvageCents = 0;
  const salvage = (productId: string, quantity: number): void => {
    if (quantity <= 0) return;
    salvageUnits += quantity;
    salvageCents += Math.round(getProduct(productId).basePrice * SALVAGE_RATE) * quantity;
  };
  for (const inv of [fac.inputInventory, fac.outputInventory]) {
    for (const pid in inv) salvage(pid, inv[pid]!.quantity);
  }

  // Vehicles bound to or from it have nowhere to go — removed; the seller's own
  // in-transit cargo is salvaged with the stored stock (other firms' vehicles
  // that merely routed through keep no value here — they never did).
  for (const vid in state.vehicles) {
    const v = state.vehicles[vid]!;
    if (v.originFacilityId === facilityId || v.destinationFacilityId === facilityId) {
      if (v.ownerFirmId === firmId) salvage(v.cargo.productId, v.cargo.quantity);
      delete state.vehicles[vid];
    }
  }

  firm.facilities = firm.facilities.filter((id) => id !== facilityId);
  const name = fac.name;
  delete state.facilities[facilityId];

  const proceeds = refund + salvageCents;
  if (proceeds > 0) {
    recordTransaction(state, {
      from: WORLD_ACCOUNT,
      to: firmAccount(firmId),
      amount: proceeds,
      firmId,
      // Balance-sheet movement (asset -> cash), not P&L.
      category: 'none',
      note: salvageUnits > 0
        ? `Sold ${name} (${salvageUnits} units salvaged)`
        : `Sold ${name}`,
    });
  }
  const salvageNote = salvageUnits > 0
    ? ` plus ${formatMoney(salvageCents)} salvaged stock`
    : '';
  emitEvent(state, 'info', firm.ownerType === 'player' ? 'player' : 'ai',
    `Sold ${name} for ${formatMoney(refund)} (half its build cost)${salvageNote}.`, firmId);
  return true;
}
