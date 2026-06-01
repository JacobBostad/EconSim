/**
 * Vehicle.ts — Shipment / vehicle entity.
 *
 * A vehicle carries cargo from a source facility to a destination facility over
 * a number of ticks derived from distance. Shipments are created by the
 * LogisticsSystem when a contract's reorder point is hit, and dissolved on
 * arrival when cargo is delivered into the destination's input inventory.
 */

import type {
  VehicleId,
  FirmId,
  FacilityId,
  ProductId,
  ContractId,
} from '../core/Id';
import type { Vec2 } from './Location';

export type VehicleStatus = 'enroute' | 'delivered';

export interface VehicleCargo {
  productId: ProductId;
  quantity: number;
  quality: number;
}

export interface Vehicle {
  id: VehicleId;
  ownerFirmId: FirmId;
  contractId: ContractId | null;
  originFacilityId: FacilityId;
  destinationFacilityId: FacilityId;
  cargo: VehicleCargo;
  capacity: number;
  currentLocation: Vec2;
  targetLocation: Vec2;
  status: VehicleStatus;
  ticksUntilArrival: number;
  transportCost: number; // cents, charged on arrival
}
