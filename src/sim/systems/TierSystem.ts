/**
 * TierSystem — the prosperity ladder (docs/design/classes-and-ascension.md).
 *
 * Citizens climb worker → comfortable → affluent when steady wages, decent
 * satisfaction, and (for affluent) good housing or savings hold up over
 * days — and slide back down when their tier's floor gives way. Hysteresis
 * on both sides: one payday never gentrifies the town, one bad day never
 * demotes anyone.
 *
 * Phase 1 is machinery only: tiers are derived and displayed but change no
 * behavior yet (tiered demand and store positioning are later phases).
 * Rules are pure functions of citizen state — no rng draws — so this
 * system's insertion leaves the shared rng stream untouched.
 *
 * Wage bars scale with the config's subsistence income so difficulty
 * presets keep the ladder proportionate. The unattended labor market
 * converges to a single town wage (~$16/day) with zero dispersion, so a
 * wage-only bar strands everyone in `worker` — each bar therefore accepts
 * savings as an alternative route. Wealth (citizen cash) is the signal
 * that actually spreads; wages only differentiate when the player pays
 * above market. Thresholds were calibrated against 300-day unattended
 * probes (seeds 11 and 4) — see the design doc's probe results.
 */

import type { SimContext, GameState } from '../core/GameState';
import { emitEvent } from '../core/GameState';
import { isDayBoundary } from '../core/Tick';
import type { Citizen, CitizenTier } from '../entities/Citizen';

/** Wage bars as multiples of subsistence income ($14/day at standard). */
export const COMFORTABLE_WAGE_MULT = 18 / 14; // ≈ $18/day
export const COMFORTABLE_WAGE_FLOOR_MULT = 16 / 14; // ≈ $16/day
export const AFFLUENT_WAGE_MULT = 26 / 14; // ≈ $26/day
export const AFFLUENT_WAGE_FLOOR_MULT = 22 / 14; // ≈ $22/day

export const COMFORTABLE_SATISFACTION = 60;
export const COMFORTABLE_SATISFACTION_FLOOR = 45;
export const AFFLUENT_SATISFACTION = 70;
export const AFFLUENT_SATISFACTION_FLOOR = 55;

/** Savings routes: cash that substitutes for an above-market wage. */
export const COMFORT_SAVINGS_CENTS = 250_00;
export const COMFORT_SAVINGS_FLOOR_CENTS = 150_00;
export const AFFLUENT_WEALTH_CENTS = 350_00;
export const AFFLUENT_WEALTH_FLOOR_CENTS = 250_00;

/** Cash that substitutes for premium housing on the affluent bar. */
export const AFFLUENT_SAVINGS_CENTS = 600_00;

export const PROMOTION_DAYS = 5;
export const AFFLUENT_PROMOTION_DAYS = 7;
export const DEMOTION_DAYS = 5;

const ORDER: CitizenTier[] = ['worker', 'comfortable', 'affluent'];

/**
 * Phase 2 — tiered demand. Each tier's appetite scales the per-citizen need
 * growth rate (purchase FREQUENCY, not basket size — quantity multipliers
 * were probed to overshoot production capacity; see the coffee lesson in
 * the balance notes). Strictly ADDITIVE above the worker baseline: probes
 * showed any per-capita cut for workers (even ×0.9 coffee) contracts the
 * whole town ~10% by day 300 — revenue falls, cafés shed staff, immigration
 * stalls. The calibrated economy IS the worker baseline; prosperity only
 * adds demand, so ascension is strictly good news for shopkeepers. Luxury
 * at 0 replaces the old satisfaction+cash aspiration gate: the tier ladder
 * IS the aspiration signal now, and its hysteresis means new money takes a
 * week to become new tastes.
 */
const GROWTH_MULT: Record<CitizenTier, Record<string, number>> = {
  worker: { pastries: 0, jewelry: 0 },
  comfortable: { pastries: 0.5, jewelry: 0.3 },
  affluent: { coffee: 1.5, clothes: 1.4, pastries: 1.5, jewelry: 1.5 },
};

/** Affluent citizens tolerate premium prices on their favorite categories. */
const PRICE_CAP_MULT: Record<CitizenTier, Record<string, number>> = {
  worker: {},
  comfortable: {},
  affluent: { bread: 1.1, coffee: 1.2, clothes: 1.2 },
};

export function tierNeedGrowthMult(tier: CitizenTier, productId: string): number {
  return GROWTH_MULT[tier][productId] ?? 1;
}

export function tierPriceCapMult(tier: CitizenTier, productId: string): number {
  return PRICE_CAP_MULT[tier][productId] ?? 1;
}

function livesInApartment(state: GameState, cit: Citizen): boolean {
  return state.facilities[cit.homeFacilityId]?.defId === 'apartment';
}

/** Does this citizen meet the ENTRY bar for `tier` right now? */
export function meetsEntryBar(state: GameState, cit: Citizen, tier: CitizenTier): boolean {
  const sub = state.config.subsistenceIncomePerDay;
  if (tier === 'comfortable') {
    return (
      cit.employmentStatus === 'employed' &&
      cit.satisfaction >= COMFORTABLE_SATISFACTION &&
      (cit.wage >= sub * COMFORTABLE_WAGE_MULT || cit.cash >= COMFORT_SAVINGS_CENTS)
    );
  }
  if (tier === 'affluent') {
    return (
      cit.employmentStatus === 'employed' &&
      cit.satisfaction >= AFFLUENT_SATISFACTION &&
      (cit.wage >= sub * AFFLUENT_WAGE_MULT || cit.cash >= AFFLUENT_WEALTH_CENTS) &&
      (livesInApartment(state, cit) || cit.cash >= AFFLUENT_SAVINGS_CENTS)
    );
  }
  return true; // worker: everyone qualifies
}

/** Does this citizen still hold the FLOOR of their current tier? */
export function holdsFloor(state: GameState, cit: Citizen): boolean {
  const sub = state.config.subsistenceIncomePerDay;
  if (cit.tier === 'comfortable') {
    return (
      cit.employmentStatus === 'employed' &&
      cit.satisfaction >= COMFORTABLE_SATISFACTION_FLOOR &&
      (cit.wage >= sub * COMFORTABLE_WAGE_FLOOR_MULT || cit.cash >= COMFORT_SAVINGS_FLOOR_CENTS)
    );
  }
  if (cit.tier === 'affluent') {
    return (
      cit.employmentStatus === 'employed' &&
      cit.satisfaction >= AFFLUENT_SATISFACTION_FLOOR &&
      (cit.wage >= sub * AFFLUENT_WAGE_FLOOR_MULT || cit.cash >= AFFLUENT_WEALTH_FLOOR_CENTS)
    );
  }
  return true; // worker is the ground floor
}

/**
 * Migration/backfill heuristic: a one-shot tier guess from a snapshot,
 * without streak history. Used when loading pre-tier saves.
 */
export function snapshotTier(state: GameState, cit: Citizen): CitizenTier {
  const probe = { ...cit, tier: 'worker' as CitizenTier };
  if (meetsEntryBar(state, probe, 'affluent')) return 'affluent';
  if (meetsEntryBar(state, probe, 'comfortable')) return 'comfortable';
  return 'worker';
}

export function runTierSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isDayBoundary(state.tick, ctx.config)) return;

  for (const cid in state.citizens) {
    const cit = state.citizens[cid]!;
    const idx = ORDER.indexOf(cit.tier);
    const next = ORDER[idx + 1];

    if (next && meetsEntryBar(state, cit, next)) {
      cit.tierStreak = Math.max(1, cit.tierStreak + 1);
      const needed = next === 'affluent' ? AFFLUENT_PROMOTION_DAYS : PROMOTION_DAYS;
      if (cit.tierStreak >= needed) {
        cit.tier = next;
        cit.tierStreak = 0;
        if (next === 'affluent') {
          emitEvent(state, 'success', 'economy',
            `🥂 ${cit.name} is prospering — steady income and a healthy nest egg lifted them into comfort's upper rung.`, cid);
        }
      }
    } else if (!holdsFloor(state, cit)) {
      cit.tierStreak = Math.min(-1, cit.tierStreak - 1);
      if (cit.tierStreak <= -DEMOTION_DAYS) {
        cit.tier = ORDER[Math.max(0, idx - 1)]!;
        cit.tierStreak = 0;
      }
    } else {
      cit.tierStreak = 0;
    }
  }
}
