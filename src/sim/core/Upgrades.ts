/**
 * Upgrades.ts — facility levels, shared by the player command and the AI.
 *
 * Levels 1→3. Each upgrade costs 60% of the (land-adjusted) build cost per
 * current level and grants: +40% of base storage, +1 worker capacity, and
 * +15% production efficiency (applied in ProductionSystem via `level`).
 */

import type { GameState } from './GameState';
import { canAfford, emitEvent, recordTransaction } from './GameState';
import { firmAccount, WORLD_ACCOUNT } from './Transactions';
import type { FirmId, FacilityId } from './Id';
import { getFacilityDef } from '../data/facilityDefinitions';
import { landCostMultiplier, landValueAt } from './LandValue';

export const MAX_FACILITY_LEVEL = 3;

/** Cost to take the facility to the next level (0 when maxed). */
export function upgradeCost(state: GameState, facilityId: FacilityId): number {
  const fac = state.facilities[facilityId];
  if (!fac || fac.level >= MAX_FACILITY_LEVEL) return 0;
  const def = getFacilityDef(fac.defId);
  const mult = landCostMultiplier(landValueAt(state, fac.location));
  return Math.round(def.buildCost * 0.6 * fac.level * mult);
}

export function upgradeFacility(
  state: GameState,
  firmId: FirmId,
  facilityId: FacilityId,
): boolean {
  const firm = state.firms[firmId];
  const fac = state.facilities[facilityId];
  if (!firm || !fac || fac.ownerFirmId !== firmId) return false;
  if (fac.level >= MAX_FACILITY_LEVEL) return false;
  const def = getFacilityDef(fac.defId);
  if (def.buildCost <= 0) return false; // homes/importer can't upgrade

  const cost = upgradeCost(state, facilityId);
  if (!canAfford(state, firmAccount(firmId), cost)) {
    if (firm.ownerType === 'player') {
      emitEvent(state, 'danger', 'player', `Upgrading ${fac.name} costs ${cost}¢ — not enough cash.`, fac.id);
    }
    return false;
  }

  recordTransaction(state, {
    from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: cost,
    firmId, category: 'buildSpend', note: `Upgraded ${fac.name} to L${fac.level + 1}`,
  });
  fac.level += 1;
  fac.storageCapacity = Math.round(def.storageCapacity * (1 + 0.4 * (fac.level - 1)));
  fac.workerCapacity = def.workerCapacity + (fac.level - 1);
  emitEvent(
    state,
    firm.ownerType === 'player' ? 'success' : 'info',
    firm.ownerType === 'player' ? 'player' : 'ai',
    `⬆ ${fac.name} upgraded to level ${fac.level} — bigger, faster, roomier.`,
    fac.id,
  );
  return true;
}
