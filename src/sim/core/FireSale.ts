/**
 * FireSale.ts — rival fire-sale offers and the transfer that accepts them.
 *
 * A distressed rival's losing facility becomes a deal for the player: the
 * offer asks 75% of build cost, and accepting transfers the building, its
 * crew (they keep their jobs, now on the player's payroll), and its supply
 * lines. Contract plumbing keeps the engine's invariants: contracts the
 * seller owned that FEED the sold facility move to the player (they're the
 * buyer now — the normal cross-firm wholesale shape), while contracts that
 * SOURCE from it keep their owners and simply start paying the player at
 * ship time, exactly like any other cross-firm supplier switch.
 */

import type { GameState } from './GameState';
import { canAfford, emitEvent, recordTransaction } from './GameState';
import { townOf } from './Town';
import { firmAccount } from './Transactions';
import { formatMoney } from '../../utils/formatMoney';

/** Asking price as a share of recorded build cost. */
export const FIRE_SALE_RATE = 0.75;

/** Accept the active fire-sale offer. Returns true on success. */
export function acceptFacilityOffer(state: GameState): boolean {
  const offer = state.facilityOffer;
  if (!offer) return false;
  const fac = state.facilities[offer.facilityId];
  const firms = townOf(state).firms;
  const seller = firms[offer.sellerFirmId];
  const buyer = firms[state.playerFirmId];
  // The world may have moved on: facility sold/closed, seller acquired.
  if (!fac || !seller || !buyer || fac.ownerFirmId !== offer.sellerFirmId) {
    state.facilityOffer = null;
    return false;
  }
  if (!canAfford(state, firmAccount(buyer.id), offer.askCents)) {
    emitEvent(state, 'danger', 'finance',
      `Not enough cash for ${fac.name} (needs ${formatMoney(offer.askCents)}).`, buyer.id);
    return false;
  }

  recordTransaction(state, {
    from: firmAccount(buyer.id),
    to: firmAccount(seller.id),
    amount: offer.askCents,
    firmId: null,
    // Balance-sheet movement on both sides (cash <-> asset), not P&L.
    category: 'none',
    note: `Bought ${fac.name} from ${seller.name}`,
  });

  // The building changes hands with its crew.
  fac.ownerFirmId = buyer.id;
  seller.facilities = seller.facilities.filter((id) => id !== fac.id);
  buyer.facilities.push(fac.id);
  const citizens = townOf(state).citizens;
  for (const cid of fac.employees) {
    const cit = citizens[cid];
    if (!cit) continue;
    seller.employees = seller.employees.filter((id) => id !== cid);
    if (!buyer.employees.includes(cid)) buyer.employees.push(cid);
    cit.employerFirmId = buyer.id;
  }

  // Seller-owned contracts feeding the facility become the player's sourcing
  // lines; contracts sourcing FROM it keep their owners (see header).
  for (const cid in state.contracts) {
    const c = state.contracts[cid]!;
    if (c.ownerFirmId === seller.id && c.destinationFacilityId === fac.id) {
      c.ownerFirmId = buyer.id;
    }
  }

  state.facilityOffer = null;
  state.fireSalesBought += 1;
  emitEvent(state, 'success', 'finance',
    `🏷️ Fire sale closed — ${buyer.name} bought ${fac.name} from ${seller.name} for ${formatMoney(offer.askCents)} (75% of build cost), crew and supply lines included.`,
    fac.id);
  return true;
}
