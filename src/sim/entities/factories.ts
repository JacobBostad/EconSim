/**
 * factories.ts — Runtime entity constructors that mutate GameState.
 *
 * Used by command handling (e.g. BUILD_FACILITY) to add entities consistently
 * with how the starting scenario builds them.
 */

import type { GameState } from '../core/GameState';
import { nextId } from '../core/Id';
import type { FacilityDefId, FirmId } from '../core/Id';
import type { Vec2 } from './Location';
import type { Facility } from './Facility';
import { emptyFacilityDailyStats } from './Facility';
import { getFacilityDef } from '../data/facilityDefinitions';

export function createFacility(
  state: GameState,
  defId: FacilityDefId,
  ownerFirmId: FirmId,
  location: Vec2,
  opts: { name?: string } = {},
): Facility {
  const def = getFacilityDef(defId);
  const id = nextId(state.idCounters, 'fac');
  const fac: Facility = {
    id,
    defId,
    name: opts.name ?? `${def.name} ${id}`,
    type: def.type,
    ownerFirmId,
    location: { ...location },
    employees: [],
    inputInventory: {},
    outputInventory: {},
    storageCapacity: def.storageCapacity,
    recipes: [...def.allowedRecipes],
    activeRecipeId: null,
    retailProductId: null,
    operatingCostPerDay: def.maintenanceCostPerDay,
    buildCost: def.buildCost,
    productionProgress: 0,
    status: 'idle',
    bottleneckReason: null,
    dailyStats: emptyFacilityDailyStats(),
    presentWorkers: 0,
    residentIds: [],
  };
  state.facilities[id] = fac;
  const firm = state.firms[ownerFirmId];
  if (firm) firm.facilities.push(id);
  return fac;
}
