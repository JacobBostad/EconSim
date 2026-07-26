/**
 * ai/LandlordBehavior.ts — the LANDLORD archetype's daily loop (Arc D2, HD4).
 *
 * A landlord firm's whole business is real estate: it develops apartment blocks
 * and operates them for rent. This is the D2 lift of the `maybeBuildApartment`
 * seam out of ai/expansion.ts — but only for LANDLORD firms. Operator firms
 * keep calling the original `maybeBuildApartment` verbatim (their pinned
 * baselines must not move), so the operator seam stays exactly where it was;
 * this module is a landlord-shaped sibling, not a move.
 *
 * The loop, in order:
 *   1. SOLVENCY FIRST. Under distress (cash below the keep floor), sell the
 *      least-valuable block through the B3 machinery (Demolition.sellFacility)
 *      to raise cash before doing anything else — a landlord that keeps
 *      building into a squeeze goes insolvent.
 *   2. DEVELOP. When town housing is tight (no vacant home slots and the home
 *      cap not yet hit) and it can afford to, build another apartment block near
 *      the residential district. Its blocks join the existing rent pipeline:
 *      cast residents pay APARTMENT_RENT_PER_DAY (RentSystem) and the block's
 *      spare capacity houses crowd renters who pay CROWD_RENT_PER_DAY
 *      (CrowdRentSystem) — the landlord's income scales with the town's
 *      population, which is the point.
 *
 * DETERMINISM. Every gate here is a cash/occupancy read or a salted-hash roll
 * keyed (seed, day, firmId) — the FireSaleSystem independent-stream idiom — so
 * the loop draws ZERO from the shared rng. A landlord firm only exists when the
 * real-estate channel is on (never in a pinned baseline), but keeping it off the
 * shared stream means even a hand-placed landlord can't perturb a trajectory.
 *
 * RENT-SETTING WALK. Residential rent is the shared, pinned pool-drift sink
 * (CROWD_RENT_PER_DAY / APARTMENT_RENT_PER_DAY) — a landlord's blocks charge it
 * as-is, so the crowd-tier economy the City soak calibrated is untouched. The
 * landlord's own price walk lives on its COMMERCIAL leases (the rentPerDay ask,
 * `commercialLeaseAsk` below), which it sets to a target yield on the premises'
 * book value and which the player accepts through the build/lease flow. See
 * docs/design/real-estate.md.
 */

import type { SimContext, GameState } from '../../core/GameState';
import type { Firm } from '../../entities/Firm';
import { emitEvent, recordTransaction } from '../../core/GameState';
import { townOf } from '../../core/Town';
import { firmAccount, WORLD_ACCOUNT } from '../../core/Transactions';
import { getFacilityDef } from '../../data/facilityDefinitions';
import { createFacility } from '../../entities/factories';
import { clamp } from '../../../utils/clamp';
import { landCostMultiplier, landValueAt } from '../../core/LandValue';
import { facilityBookValue, sellFacility } from '../../core/Demolition';
import { APARTMENT_CAPACITY } from '../../data/constants';
import type { DigestBuffer } from './digest';

/** A landlord keeps at least this much cash after a build — real-estate is
 * capital-heavy and a block that empties the treasury is a fast bankruptcy. */
const LANDLORD_KEEP_BUFFER = 30000_00;
/** Below this cash a landlord is in distress and raises cash by selling a block
 * (B3) before it develops anything. Above the keep buffer so the two bands
 * don't fight (sell low, build high). */
const LANDLORD_DISTRESS_CASH = 12000_00;
/** Daily hash-gated odds a flush landlord breaks ground on a new block when
 * housing is tight — paces development so a landlord grows the housing stock
 * without carpeting the map in a week. */
const LANDLORD_BUILD_CHANCE = 0.25;
/** Target annualized rent yield a landlord asks on the book value of a
 * commercial premises it finances for a tenant (HD4 item 3). Sits inside the
 * measured 12-18% residential band so the two revenue lines are comparable. */
export const COMMERCIAL_TARGET_YIELD = 0.15;

/**
 * Town housing occupancy: filled home slots over total home slots across every
 * `home`-type facility. A regular home holds 2; an apartment block holds
 * APARTMENT_CAPACITY (cast residents + crowd tenants). Returns 0 for a town with
 * no housing. Exported for the founder row and probes. Deterministic read.
 */
export function townHousingOccupancy(state: GameState): number {
  // Bare-`state` helper mid-gradient: home town by default (one-town region →
  // same reference); gains a `townId` param at the endgame move.
  const town = townOf(state);
  let filled = 0;
  let capacity = 0;
  for (const fid in town.facilities) {
    const f = town.facilities[fid]!;
    if (f.type !== 'home') continue;
    if (f.defId === 'apartment') {
      capacity += APARTMENT_CAPACITY;
      filled += f.residentIds.length + f.crowdTenants;
    } else {
      capacity += 2;
      filled += f.residentIds.length;
    }
  }
  return capacity > 0 ? filled / capacity : 0;
}

/** The commercial lease rent a landlord asks for a premises of the given book
 * value: the target-yield annuity, floored at $1/day so a cheap shell still
 * bills. Exported for the lease command + tests. */
export function commercialLeaseAsk(bookValue: number): number {
  return Math.max(100, Math.round((bookValue * COMMERCIAL_TARGET_YIELD) / 365));
}

/**
 * Whether a landlord will front `cost` to finance a premises for a tenant to
 * lease (Arc D2 / HD4 item 2). The landlord stays RATIONAL but the bar is its
 * DISTRESS floor, not the full development keep-buffer: fronting a lease is a
 * recoverable, yield-bearing asset play, NOT a capital sink like an apartment it
 * commits to operate. The downside is bounded — a tenant that goes insolvent
 * RETURNS the premises through the BankruptcySystem repossession rung — so the
 * landlord fronts down to the same `LANDLORD_DISTRESS_CASH` line at which it
 * would start selling blocks, keeping only enough that financing the lease can't
 * by itself tip it into the sell-a-block distress band. Never fronts while
 * insolvent. Exported for the AI operator's lease-vs-buy decision
 * (ai/expansion.ts). A pure read: no rng.
 */
export function landlordCanFinance(landlord: Firm, cost: number): boolean {
  if (landlord.bankruptcyStatus === 'insolvent') return false;
  return landlord.cash - cost >= LANDLORD_DISTRESS_CASH;
}

/** Salted-hash daily gate keyed (seed, day, firmId) — the FireSaleSystem
 * independent-stream idiom, so it never touches the shared rng. */
function landlordRoll(seed: number, day: number, firmId: string, chance: number): boolean {
  let h = seed >>> 0;
  for (let i = 0; i < firmId.length; i++) h = Math.imul(h ^ firmId.charCodeAt(i), 0x01000193) >>> 0;
  let t = (h ^ Math.imul(day + 733, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 < chance;
}

/** True when the town has zero vacant cast home slots and the home cap isn't hit
 * — the same housing-squeeze read the operator's maybeBuildApartment uses, so a
 * landlord develops under exactly the conditions that warrant new stock. */
function housingSqueezed(state: GameState): boolean {
  // Bare-`state` helper mid-gradient: home town by default (one-town region →
  // same reference); gains a `townId` param at the endgame move.
  const town = townOf(state);
  let homes = 0;
  let vacancies = 0;
  for (const fid in town.facilities) {
    const f = town.facilities[fid]!;
    if (f.type !== 'home') continue;
    homes += 1;
    if (f.residentIds.length < 2) vacancies += 1;
  }
  return homes > 0 && vacancies === 0 && homes < state.config.maxHomes;
}

/** Sell the landlord's least-valuable block to raise cash under distress (B3).
 * Returns true if a block was sold. */
function sellWeakestBlock(ctx: SimContext, firmId: string): boolean {
  const { state } = ctx;
  const town = townOf(state, ctx.townId);
  const firm = town.firms[firmId]!;
  let target: string | null = null;
  let lowest = Infinity;
  for (const facId of firm.facilities) {
    const fac = town.facilities[facId];
    if (!fac || fac.defId !== 'apartment') continue;
    const bv = facilityBookValue(fac);
    if (bv < lowest) {
      lowest = bv;
      target = facId;
    }
  }
  if (!target) return false;
  const name = town.facilities[target]!.name;
  const sold = sellFacility(state, firmId, target);
  if (sold) {
    emitEvent(state, 'warning', 'ai',
      `🏢 ${firm.name} sold ${name} to shore up its balance sheet.`, firmId);
  }
  return sold;
}

/** Develop one apartment block near the residential band when housing is tight
 * and the landlord can afford it. Mirrors the operator seam's siting + costing;
 * deterministic apart from the paced hash gate. */
function developBlock(ctx: SimContext, firmId: string): void {
  const { state } = ctx;
  const town = townOf(state, ctx.townId);
  const firm = town.firms[firmId]!;
  if (!housingSqueezed(state)) return;
  if (!landlordRoll(state.seed, ctx.time.day, firmId, LANDLORD_BUILD_CHANCE)) return;

  const loc = {
    x: clamp(40 + ((ctx.time.day * 37 + firm.facilities.length * 13) % 49) - 24, 8, town.mapWidth - 8),
    y: clamp(64 + ((ctx.time.day * 17) % 13) - 6, 8, town.mapHeight - 8),
  };
  const def = getFacilityDef('apartment');
  const mult = landCostMultiplier(landValueAt(state, loc));
  const cost = Math.round(def.buildCost * mult);
  if (firm.cash - cost < LANDLORD_KEEP_BUFFER) return;

  const apt = createFacility(state, 'apartment', firmId, loc, {
    name: `${firm.name.split(' ')[0]} Residences`,
  });
  apt.buildCost = cost;
  apt.operatingCostPerDay = Math.round(def.maintenanceCostPerDay * mult);
  recordTransaction(state, {
    from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: cost,
    firmId, category: 'buildSpend', note: 'Built apartment',
  });
  emitEvent(state, 'info', 'ai',
    `🏢 ${firm.name} broke ground on ${apt.name} — new housing for a growing town.`, apt.id);
}

/**
 * Run one landlord firm's daily loop. Called by the AIStrategySystem dispatcher
 * for firms whose archetype is 'landlord'. Deliberately does NOT touch
 * strategy.lossStreak (that's an operator concept) so the archetype-routing test
 * can still prove a landlord never ran the operator loop.
 */
export function runLandlordBehavior(
  ctx: SimContext,
  firmId: string,
  _digest: DigestBuffer | undefined,
): void {
  const { state } = ctx;
  const town = townOf(state, ctx.townId);
  const firm = town.firms[firmId];
  if (!firm) return;
  // Insolvent landlords are BankruptcySystem's to wind down; do nothing.
  if (firm.bankruptcyStatus === 'insolvent') return;

  // 1. Solvency first: raise cash by selling a block if the treasury is thin.
  if (firm.cash < LANDLORD_DISTRESS_CASH) {
    sellWeakestBlock(ctx, firmId);
    return; // one balance-sheet move per day; regroup tomorrow
  }

  // 2. Develop when housing is tight and there's cash to build.
  developBlock(ctx, firmId);
}
