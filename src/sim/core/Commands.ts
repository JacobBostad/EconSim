/**
 * Commands.ts — The intent API between UI and simulation.
 *
 * React never mutates simulation state. It dispatches one of these commands;
 * the Simulation validates and applies it. Commands are plain serializable
 * objects so a command sequence can be logged/replayed for determinism testing.
 */

import type {
  FirmId,
  FacilityId,
  CitizenId,
  ProductId,
  RecipeId,
  FacilityDefId,
  ContractId,
  EntityId,
} from './Id';
import type { Vec2 } from '../entities/Location';

export type Speed = 0 | 1 | 5 | 20 | 100;

export type Command =
  | { type: 'START_NEW_GAME'; seed: number }
  | { type: 'LOAD_GAME'; slot?: string }
  | { type: 'SAVE_GAME'; slot?: string }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'SET_SPEED'; speed: Speed }
  | { type: 'CREATE_COMPANY'; name: string; startingCash: number }
  | {
      type: 'BUILD_FACILITY';
      firmId: FirmId;
      defId: FacilityDefId;
      location: Vec2;
    }
  | { type: 'SELECT_RECIPE'; facilityId: FacilityId; recipeId: RecipeId | null }
  | {
      type: 'SET_RETAIL_PRODUCT';
      facilityId: FacilityId;
      productId: ProductId | null;
    }
  | { type: 'SET_PRICE'; firmId: FirmId; productId: ProductId; price: number }
  | { type: 'SET_AUTO_PRICE'; firmId: FirmId; productId: ProductId; enabled: boolean }
  | { type: 'BUILD_CHAIN'; firmId: FirmId; productId: ProductId }
  | { type: 'UPGRADE_FACILITY'; firmId: FirmId; facilityId: FacilityId }
  | { type: 'CIVIC_ACTION'; firmId: FirmId; action: 'festival' | 'fund_home' }
  | {
      type: 'SET_EXPORT_ORDER';
      facilityId: FacilityId;
      productId: ProductId;
      /** null clears the standing order. */
      minMult: number | null;
      keep: number;
    }
  | {
      type: 'EXPORT_GOODS';
      firmId: FirmId;
      facilityId: FacilityId;
      productId: ProductId;
      quantity: number;
    }
  | { type: 'SET_WAGE'; firmId: FirmId; wage: number }
  | { type: 'HIRE_WORKER'; facilityId: FacilityId; citizenId: CitizenId | null }
  | { type: 'FIRE_WORKER'; facilityId: FacilityId; citizenId: CitizenId }
  | {
      type: 'CREATE_SUPPLY_CONTRACT';
      ownerFirmId: FirmId;
      sourceFacilityId: FacilityId;
      destinationFacilityId: FacilityId;
      productId: ProductId;
      targetQuantity: number;
      reorderPoint: number;
      maxInventory: number;
    }
  | { type: 'CANCEL_SUPPLY_CONTRACT'; contractId: ContractId }
  | {
      type: 'UPDATE_SUPPLY_CONTRACT';
      contractId: ContractId;
      targetQuantity?: number;
      reorderPoint?: number;
      maxInventory?: number;
      active?: boolean;
    }
  | {
      type: 'BUY_FROM_IMPORTER';
      firmId: FirmId;
      destinationFacilityId: FacilityId;
      productId: ProductId;
      quantity: number;
    }
  | { type: 'SET_AD_BUDGET'; firmId: FirmId; productId: ProductId; dailyBudget: number }
  | { type: 'INVEST_RND'; firmId: FirmId; productId: ProductId; amount: number }
  | { type: 'TAKE_LOAN'; firmId: FirmId; amount: number }
  | { type: 'REPAY_LOAN'; firmId: FirmId; amount: number }
  | { type: 'ACQUIRE_FIRM'; firmId: FirmId; targetFirmId: FirmId }
  | { type: 'BUY_SHARES'; firmId: FirmId; targetFirmId: FirmId; percent: number }
  | { type: 'SELL_SHARES'; firmId: FirmId; targetFirmId: FirmId; percent: number }
  | { type: 'SELECT_ENTITY'; entityId: EntityId | null };

export type CommandType = Command['type'];
