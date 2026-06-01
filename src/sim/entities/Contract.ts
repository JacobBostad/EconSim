/**
 * Contract.ts — Supply contract entity.
 *
 * A supply contract instructs the LogisticsSystem to keep a destination
 * facility's input inventory of one product topped up from a source facility's
 * output inventory, using reorder-point logic. Intra-firm transfers move goods
 * at cost; importer contracts (source = importer) represent purchasing.
 */

import type {
  ContractId,
  FacilityId,
  FirmId,
  ProductId,
} from '../core/Id';

export interface Contract {
  id: ContractId;
  ownerFirmId: FirmId;
  sourceFacilityId: FacilityId;
  destinationFacilityId: FacilityId;
  productId: ProductId;
  /** Desired quantity to bring the destination up to on each shipment. */
  targetQuantity: number;
  /** When destination input inventory drops below this, trigger a shipment. */
  reorderPoint: number;
  /** Do not stock the destination above this. */
  maxInventory: number;
  /** Transport cost in cents per shipment (flat + handled by logistics). */
  transportCost: number;
  active: boolean;
}
