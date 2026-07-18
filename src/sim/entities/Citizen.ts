/**
 * Citizen.ts — Citizen entity.
 *
 * Citizens live in homes, optionally work at a facility for wages, accumulate
 * needs over time, and shop after work. Their day is driven by a simple state
 * machine (`activity`) advanced by CitizenScheduleSystem + MovementSystem.
 */

import type {
  CitizenId,
  FirmId,
  FacilityId,
  ProductId,
} from '../core/Id';
import type { Vec2 } from './Location';

export type EmploymentStatus = 'employed' | 'unemployed';

/** Prosperity ladder (see docs/design/classes-and-ascension.md). */
export type CitizenTier = 'worker' | 'comfortable' | 'affluent';

export type CitizenActivity =
  | 'sleeping' // at home, before work
  | 'commuting-to-work'
  | 'working'
  | 'commuting-to-shop'
  | 'shopping'
  | 'commuting-home'
  | 'home'; // at home, after work/shopping

export type MovementState = 'idle' | 'moving';

/** A single recurring need for a product. */
export interface CitizenNeed {
  productId: ProductId;
  /** 0..~2 — how badly the citizen wants this now. Triggers shopping above threshold. */
  urgency: number;
  /** How much urgency grows per in-game day. */
  urgencyGrowthPerDay: number;
  /** Units the citizen wants to buy when shopping. */
  preferredQuantity: number;
  /** Citizen will not pay above basePrice * this multiplier. */
  maxAffordablePriceMultiplier: number;
  lastSatisfiedTick: number;
}

export interface CitizenDailyStats {
  day: number;
  wagesEarned: number;
  spent: number;
  purchases: number;
  unmetNeeds: number;
}

export interface Citizen {
  id: CitizenId;
  name: string;
  homeFacilityId: FacilityId;
  employerFirmId: FirmId | null;
  workplaceFacilityId: FacilityId | null;
  role: string;
  wage: number; // cents per payday
  cash: number; // cents
  needs: CitizenNeed[];
  /** Product preference multipliers (brand affinity), 0.5..1.5. */
  preferences: Record<ProductId, number>;
  currentLocation: Vec2;
  targetLocation: Vec2;
  targetFacilityId: FacilityId | null;
  movementState: MovementState;
  activity: CitizenActivity;
  satisfaction: number; // 0..100
  employmentStatus: EmploymentStatus;
  /** Prosperity tier, derived daily with hysteresis by TierSystem. */
  tier: CitizenTier;
  /**
   * Signed streak toward a tier change: positive days meeting the next
   * tier's entry bar, negative days failing the current tier's floor.
   * Resets on any tier change or when neither condition holds.
   */
  tierStreak: number;
  /** Last facility the citizen successfully bought each product from. */
  lastPurchasedFromByProduct: Record<ProductId, FacilityId>;
  /** Reliability memory: facilityId -> successful purchase count. */
  storeReliability: Record<FacilityId, number>;
  dailyStats: CitizenDailyStats;
  /** Tick of the last shopping trip — enforces a cooldown between trips. */
  lastShopTick: number;
  /** Consecutive paydays the employer missed (drives quitting). */
  missedPaydays: number;
  /**
   * Productivity multiplier (~0.7..1.3). Grows with days worked, decays
   * slightly while unemployed. Averaged per crew in ProductionSystem.
   */
  skill: number;
}
