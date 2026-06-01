/**
 * supplyChainSelectors — supply-chain dashboard data: inventory by facility,
 * bottlenecks, active shipments, and contracts.
 */

import type { GameState } from '../core/GameState';
import type { Facility } from '../entities/Facility';
import type { Vehicle } from '../entities/Vehicle';
import type { Contract } from '../entities/Contract';
import type { ProductId, FacilityId } from '../core/Id';
import { getQuantity } from '../entities/Inventory';

export interface InventoryByFacilityRow {
  facilityId: FacilityId;
  facilityName: string;
  input: number;
  output: number;
}

export function inventoryByFacility(state: GameState, productId: ProductId): InventoryByFacilityRow[] {
  const rows: InventoryByFacilityRow[] = [];
  for (const id in state.facilities) {
    const f = state.facilities[id]!;
    if (f.type === 'importer') continue;
    const input = getQuantity(f.inputInventory, productId);
    const output = getQuantity(f.outputInventory, productId);
    if (input + output > 0) {
      rows.push({ facilityId: id, facilityName: f.name, input, output });
    }
  }
  return rows;
}

export interface BottleneckRow {
  facilityId: FacilityId;
  facilityName: string;
  status: Facility['status'];
  reason: string;
}

export function bottlenecks(state: GameState): BottleneckRow[] {
  const rows: BottleneckRow[] = [];
  for (const id in state.facilities) {
    const f = state.facilities[id]!;
    if (f.status === 'input-starved' || f.status === 'labor-starved' || f.status === 'inventory-full') {
      rows.push({
        facilityId: id,
        facilityName: f.name,
        status: f.status,
        reason: f.bottleneckReason ?? f.status,
      });
    }
  }
  return rows;
}

export function activeShipments(state: GameState): Vehicle[] {
  return Object.values(state.vehicles).filter((v) => v.status === 'enroute');
}

export function allContracts(state: GameState): Contract[] {
  return Object.values(state.contracts);
}

export function contractsByDestination(state: GameState, facilityId: FacilityId): Contract[] {
  return allContracts(state).filter((c) => c.destinationFacilityId === facilityId);
}

export function contractsBySource(state: GameState, facilityId: FacilityId): Contract[] {
  return allContracts(state).filter((c) => c.sourceFacilityId === facilityId);
}
