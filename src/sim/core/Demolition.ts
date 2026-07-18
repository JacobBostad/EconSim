/**
 * Demolition.ts — selling a facility back to the land.
 *
 * Without this, a misplaced building is a permanent maintenance drain and
 * mistakes are unrecoverable. Selling refunds half the recorded build cost
 * (paid by the world account — money stays conserved), releases the crew back
 * into the labor pool, and removes every reference to the facility: supply
 * contracts, in-transit vehicles, and the building itself. Goods stored inside
 * (and cargo on vehicles bound to/from it) are written off — the UI warns.
 */

import type { GameState } from './GameState';
import { formatMoney } from '../../utils/formatMoney';
import { recordTransaction, emitEvent } from './GameState';
import { firmAccount, WORLD_ACCOUNT } from './Transactions';
import type { FirmId, FacilityId } from './Id';
import { fireCitizen } from '../systems/LaborSystem';

/** Fraction of the recorded build cost refunded on sale. */
export const SELL_REFUND_RATE = 0.5;

/** Facility types that can never be sold (not a business asset). */
const UNSELLABLE_TYPES = new Set(['home', 'importer']);

/** Refund a sale would pay, or null if this facility cannot be sold. */
export function sellRefund(state: GameState, firmId: FirmId, facilityId: FacilityId): number | null {
  const fac = state.facilities[facilityId];
  const firm = state.firms[firmId];
  if (!fac || !firm) return null;
  if (fac.ownerFirmId !== firmId) return null;
  if (UNSELLABLE_TYPES.has(fac.type)) return null;
  return Math.floor(fac.buildCost * SELL_REFUND_RATE);
}

/** Sell an owned facility. Returns true on success. */
export function sellFacility(state: GameState, firmId: FirmId, facilityId: FacilityId): boolean {
  const refund = sellRefund(state, firmId, facilityId);
  if (refund === null) return false;
  const fac = state.facilities[facilityId]!;
  const firm = state.firms[firmId]!;

  // Crew back to the labor pool (fireCitizen also cleans both employee lists).
  for (const cid of [...fac.employees]) fireCitizen(state, facilityId, cid);

  // Supply contracts touching this facility are void — except other firms'
  // wholesale contracts that merely SOURCED here: those are their property,
  // so they fall back to the importer instead of vanishing (deleting them
  // would silently sever an AI chain's input line forever).
  const importer = Object.values(state.facilities).find((f) => f.type === 'importer');
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

  // Vehicles bound to or from it have nowhere to go — written off with cargo.
  for (const vid in state.vehicles) {
    const v = state.vehicles[vid]!;
    if (v.originFacilityId === facilityId || v.destinationFacilityId === facilityId) {
      delete state.vehicles[vid];
    }
  }

  firm.facilities = firm.facilities.filter((id) => id !== facilityId);
  const name = fac.name;
  delete state.facilities[facilityId];

  if (refund > 0) {
    recordTransaction(state, {
      from: WORLD_ACCOUNT,
      to: firmAccount(firmId),
      amount: refund,
      firmId,
      // Balance-sheet movement (asset -> cash), not P&L.
      category: 'none',
      note: `Sold ${name}`,
    });
  }
  emitEvent(state, 'info', 'player', `Sold ${name} for ${formatMoney(refund)} (half its build cost).`, firmId);
  return true;
}
