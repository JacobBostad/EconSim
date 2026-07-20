/**
 * Cohort.ts — a demographic block of the crowd (world-scale roadmap, HD1).
 *
 * A cohort is the population BEYOND the simulated cast: `district × tier`
 * blocks holding people, employment, satisfaction, and — critically — a REAL
 * cash pool. Cohorts are money-holding accounts (AccountKind 'cohort'), so
 * every flow in or out is a recordTransaction and total money supply stays
 * conserved by construction.
 *
 * A2 ships cohorts DARK: the record exists, the account kind works, but no
 * cohort has population until the City/Metropolis presets arrive in A3 —
 * Village towns (and every old save) behave bit-identically.
 */

import type { CitizenTier } from './Citizen';
import type { DistrictId } from './District';
import type { ProductId } from '../core/Id';

export type CohortId = string; // `${districtId}:${tier}`

export interface Cohort {
  id: CohortId;
  districtId: DistrictId;
  tier: CitizenTier;
  /** Whole people. The crowd — the cast is counted separately. */
  population: number;
  /** How many of them hold jobs (cohort headcount fills firm slots in A3). */
  employed: number;
  /** The block's shared wallet, integer cents — a real account. */
  cashPool: number;
  /** Satisfaction is a cohort property for the crowd (0..100). */
  avgSatisfaction: number;
  /** Average worker skill (~0.7..1.3), used for cohort-staffed production. */
  avgSkill: number;
  /** Unmet demand-days per product, capped at 3 days' demand — the cohort
   * analogue of need urgency (drives satisfaction pressure). */
  backlogByProduct: Record<ProductId, number>;
  /** Consecutive days the promote/demote tier gates have held (hysteresis,
   * mirroring the per-citizen tierStreak). */
  gateStreaks: { promote: number; demote: number };
}

export function cohortId(districtId: DistrictId, tier: CitizenTier): CohortId {
  return `${districtId}:${tier}`;
}

export function emptyCohort(districtId: DistrictId, tier: CitizenTier): Cohort {
  return {
    id: cohortId(districtId, tier),
    districtId,
    tier,
    population: 0,
    employed: 0,
    cashPool: 0,
    avgSatisfaction: 70,
    avgSkill: 0.95,
    backlogByProduct: {},
    gateStreaks: { promote: 0, demote: 0 },
  };
}
