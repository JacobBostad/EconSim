/**
 * CrowdRentSystem — the crowd pays for a roof (Arc A3 / HD4).
 *
 * The consumption sink that bounds cohort pool drift. The City soak measured
 * the pools climbing $3.7-4.4/capita/day with nothing to spend the wage +
 * stipend inflow on (trip- and shelf-limited demand can't absorb it), reaching
 * $900-1,360/cap by day 300 and swamping the tier savings gates. Housing costs
 * are the natural sink — everyone pays rent every day — and they pull HD4's
 * landlord economics forward: rent that lands in a landlord-owned apartment is
 * real firm revenue, so landlording finally scales with population instead of
 * with the two named cast tenants an apartment houses.
 *
 * Daily, anyCrowd-guarded, sorted throughout, zero rng. Where the rent goes:
 *
 *   - APARTMENT BLOCKS FIRST. Each landlord-owned apartment houses its cast
 *     residents as today PLUS spare capacity (APARTMENT_CAPACITY − residents)
 *     of crowd renters, assigned deterministically: fill apartments sorted by
 *     id up to their spare capacity from the district's cohorts sorted by id.
 *     Those renters' rent flows cohortAccount → landlord firmAccount as
 *     'revenue' and books the apartment's dailyStats.revenue — the SAME stream
 *     cast rent (RentSystem) books, so the landlord's P&L reads one number.
 *
 *   - EVERYONE ELSE PAYS THE WORLD. The vast majority of the crowd lives in
 *     informal housing there is no facility for; their rent flows cohortAccount
 *     → WORLD_ACCOUNT as 'none', note 'Crowd housing' — symmetric with the
 *     subsistence stipend the world already pays idle crowd. The world is the
 *     town's implicit landlord until real housing stock exists.
 *
 * AFFORDABILITY GUARD. A cohort pays at most what keeps ~30 days of per-capita
 * housing money in its pool: the per-capita rate is scaled by a smooth
 * affordability factor `clamp(cashPool / (population × CROWD_RENT_PER_DAY ×
 * RENT_BUFFER_DAYS), 0, 1)`. Above the buffer the factor is 1 (full rent);
 * below it the factor ramps continuously to 0, so a drained cohort's total rent
 * is `cashPool / RENT_BUFFER_DAYS` — never more than 1/30th of its pool, never
 * negative, and continuous in the pool (no threshold to oscillate across a day
 * boundary). A poor cohort is never rented into demand collapse.
 *
 * A town with no crowd (Village preset) exits before touching anything, so
 * Village stays bit-identical and no apartment's crowdTenants ever leaves 0.
 */

import type { SimContext, GameState } from '../core/GameState';
import { recordTransaction } from '../core/GameState';
import { townOf } from '../core/Town';
import { cohortAccount, firmAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import type { Cohort } from '../entities/Cohort';
import type { Facility } from '../entities/Facility';
import { districtAt } from '../entities/District';
import { clamp } from '../../utils/clamp';
import { APARTMENT_CAPACITY, CROWD_RENT_PER_DAY } from '../data/constants';
import { SIZE_PRESETS } from '../core/SimulationConfig';

/** Days of housing money the affordability guard preserves in a cohort's pool
 * before rent scales down (see the header). */
const RENT_BUFFER_DAYS = 30;

function anyCrowd(state: GameState): boolean {
  // Bare-`state` helper mid-gradient: home town by default (one-town region →
  // same reference); gains a `townId` param at the endgame move.
  const cohorts = townOf(state).cohorts;
  for (const cid in cohorts) {
    if (cohorts[cid]!.population > 0) return true;
  }
  return false;
}

/**
 * The smooth affordability factor in [0, 1] scaling a cohort's per-capita rent.
 * 1 while the pool holds at least RENT_BUFFER_DAYS of full rent; ramps linearly
 * to 0 as the pool drains, capping the cohort's total rent at cashPool /
 * RENT_BUFFER_DAYS so the pool can never go negative. Exported for direct
 * testing.
 */
export function rentAffordFactor(cohort: Cohort): number {
  const threshold = cohort.population * CROWD_RENT_PER_DAY * RENT_BUFFER_DAYS;
  if (threshold <= 0) return 0;
  return clamp(cohort.cashPool / threshold, 0, 1);
}

export function runCrowdRentSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isDayBoundary(state.tick, ctx.config)) return;
  // Village stays dark: no crowd means no new code path touches state.
  if (!anyCrowd(state)) return;
  const town = townOf(state, ctx.townId);

  // Snapshot each cohort's affordability factor from the pool BEFORE any rent
  // is charged, so the apartment and informal legs use one order-independent
  // rate for the day.
  const afford: Record<string, number> = {};
  for (const cid of Object.keys(town.cohorts).sort()) {
    afford[cid] = rentAffordFactor(town.cohorts[cid]!);
  }

  // Landlord-owned apartments grouped by district, in sorted-id order (facility
  // ids are iterated sorted, so each district's list is already id-sorted).
  // Reset every apartment's crowd occupancy first — it is recomputed daily.
  const aptsByDistrict: Record<string, Facility[]> = {};
  for (const fid of Object.keys(state.facilities).sort()) {
    const fac = state.facilities[fid]!;
    if (fac.defId !== 'apartment') continue;
    fac.crowdTenants = 0;
    if (fac.status === 'closed') continue;
    const owner = state.firms[fac.ownerFirmId];
    if (!owner || (owner.ownerType !== 'player' && owner.ownerType !== 'ai')) continue;
    const d = districtAt(town.districts, fac.location.x, fac.location.y);
    if (!d) continue;
    (aptsByDistrict[d.id] ??= []).push(fac);
  }

  // Populated cohorts grouped by district, sorted by id.
  const cohortsByDistrict: Record<string, Cohort[]> = {};
  for (const cid of Object.keys(town.cohorts).sort()) {
    const co = town.cohorts[cid]!;
    if (co.population <= 0) continue;
    (cohortsByDistrict[co.districtId] ??= []).push(co);
  }

  // How many of each cohort's people the apartments absorbed (the rest pay the
  // world for informal housing below).
  const housed: Record<string, number> = {};

  // --- apartment blocks first ---------------------------------------------
  for (const did of Object.keys(aptsByDistrict).sort()) {
    const apts = aptsByDistrict[did]!;
    const cohorts = cohortsByDistrict[did] ?? [];
    // A running cursor over the district's cohorts: fill apartments in id order,
    // drawing tenants from cohorts in id order and advancing as each is used up.
    let ci = 0;
    let usedInCohort = 0;
    for (const apt of apts) {
      let spare = APARTMENT_CAPACITY - apt.residentIds.length;
      if (spare <= 0) continue;
      const owner = state.firms[apt.ownerFirmId]!;
      while (spare > 0 && ci < cohorts.length) {
        const co = cohorts[ci]!;
        const available = co.population - usedInCohort;
        if (available <= 0) {
          ci += 1;
          usedInCohort = 0;
          continue;
        }
        const take = Math.min(spare, available);
        const rent = Math.min(
          Math.floor(take * CROWD_RENT_PER_DAY * afford[co.id]!),
          co.cashPool,
        );
        if (rent > 0) {
          recordTransaction(state, {
            from: cohortAccount(co.id),
            to: firmAccount(owner.id),
            amount: rent,
            firmId: owner.id,
            category: 'revenue',
            note: `Crowd rent: ${take} at ${apt.name}`,
          });
          apt.dailyStats.revenue += rent;
        }
        apt.crowdTenants += take;
        housed[co.id] = (housed[co.id] ?? 0) + take;
        usedInCohort += take;
        spare -= take;
      }
    }
  }

  // --- informal housing: the rest pay the world ---------------------------
  for (const cid of Object.keys(town.cohorts).sort()) {
    const co = town.cohorts[cid]!;
    if (co.population <= 0) continue;
    const informal = co.population - (housed[cid] ?? 0);
    if (informal <= 0) continue;
    const rent = Math.min(
      Math.floor(informal * CROWD_RENT_PER_DAY * afford[cid]!),
      co.cashPool,
    );
    if (rent <= 0) continue;
    recordTransaction(state, {
      from: cohortAccount(cid),
      to: WORLD_ACCOUNT,
      amount: rent,
      firmId: null,
      category: 'none',
      note: 'Crowd housing',
    });
  }

  // --- prosperity sink (City decoupling forward path) ---------------------
  // The flat rent above was calibrated for the ~9-firm City's ~0.38 crowd
  // employment; at the raised founder trigger the extra firms lift employment
  // toward ~0.5 and the wage inflow scales with it while the flat sink does not,
  // so the pool runs away (city-headroom drift guard). This prosperity-scaled
  // drain bounds the pool at ANY firm count: above a per-capita floor a cohort
  // sheds `rate` of its excess to the world each day, so the pool plateaus. Rate
  // 0 at every shipped preset = disabled = byte-identical to the flat-rent-only
  // regime; a City-decoupling ship turns it on for City alone. Money leaves to
  // the world account (conserved). Same daily/anyCrowd/sorted/zero-rng contract.
  const drainRate = SIZE_PRESETS[state.config.sizePreset].prosperityDrainRate;
  if (drainRate > 0) {
    const floor = SIZE_PRESETS[state.config.sizePreset].prosperityDrainFloor;
    for (const cid of Object.keys(town.cohorts).sort()) {
      const co = town.cohorts[cid]!;
      if (co.population <= 0) continue;
      const perCapita = co.cashPool / co.population;
      if (perCapita <= floor) continue;
      const drain = Math.floor((perCapita - floor) * drainRate * co.population);
      if (drain <= 0) continue;
      recordTransaction(state, {
        from: cohortAccount(cid),
        to: WORLD_ACCOUNT,
        amount: Math.min(drain, co.cashPool),
        firmId: null,
        category: 'none',
        note: 'Crowd prosperity drain',
      });
    }
  }
}
