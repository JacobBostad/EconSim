/**
 * RentSystem — the real-estate revenue loop.
 *
 * Once per day, residents of player/AI-built apartments pay rent to the
 * owning firm. Municipality homes stay free (the base game is untouched
 * unless someone builds premium housing). A resident who can't afford
 * rent with a comfortable buffer simply skips it — landlording is an
 * income stream, not an eviction simulator.
 */

import type { SimContext } from '../core/GameState';
import { recordTransaction } from '../core/GameState';
import { townOf } from '../core/Town';
import { citizenAccount, firmAccount } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import { APARTMENT_RENT_PER_DAY } from '../data/constants';

export function runRentSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isDayBoundary(state.tick, ctx.config)) return;
  const town = townOf(state, ctx.townId);

  for (const fid in state.facilities) {
    const fac = state.facilities[fid]!;
    if (fac.defId !== 'apartment' || fac.status === 'closed') continue;
    const owner = state.firms[fac.ownerFirmId];
    if (!owner || (owner.ownerType !== 'player' && owner.ownerType !== 'ai')) continue;

    for (const cid of fac.residentIds) {
      const cit = town.citizens[cid];
      if (!cit || cit.cash < APARTMENT_RENT_PER_DAY * 5) continue;
      recordTransaction(state, {
        from: citizenAccount(cid),
        to: firmAccount(owner.id),
        amount: APARTMENT_RENT_PER_DAY,
        firmId: owner.id,
        category: 'revenue',
        note: `Rent: ${cit.name} at ${fac.name}`,
      });
      fac.dailyStats.revenue += APARTMENT_RENT_PER_DAY;
    }
  }
}
