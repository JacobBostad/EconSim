/**
 * DistrictSystem — daily district desirability + land-value cache (world-scale,
 * HD6 / A4).
 *
 * Desirability blends what a district actually offers: homes (people want
 * neighbors), jobs (people want work nearby), and stocked shops (people want
 * full shelves). Pure state math — zero rng draws, sorted iteration — cached
 * on the district so cohort migration (A3) and district land value (A4) read
 * a number instead of re-scanning facilities.
 *
 * A4 adds `district.landValue`: the home-proximity land value sampled once per
 * district per day off a single shared HomeIndex, so the Districts panel reads a
 * cached number instead of the panel (or anything else) re-walking every home per
 * district. It is a display digest, not a money-path input — the money path keeps
 * its live per-point kernel (see LandValue.ts). Both caches are written here,
 * BEFORE the day's AI builders run (system order), so they read the homes present
 * at the start of the daily roll-up — the same snapshot timing desirability has
 * always had.
 */

import type { GameState, SimContext } from '../core/GameState';
import { townOf } from '../core/Town';
import { isDayBoundary } from '../core/Tick';
import { districtAt, type District } from '../entities/District';
import { buildHomeIndex, landValueFromIndex, type HomeIndex } from '../core/LandValue';
import { clamp } from '../../utils/clamp';

/** The point a district's land value is sampled at: its geometric centre. */
export function districtCentre(d: District): { x: number; y: number } {
  return { x: d.bounds.x + d.bounds.w / 2, y: d.bounds.y + d.bounds.h / 2 };
}

/**
 * A district's cached land value: the home-proximity land value at its centre.
 * Pure — pass a prebuilt index to share one snapshot across every district (the
 * daily pass does), or omit it for a one-off query. This is exactly what
 * DistrictSystem stores in `district.landValue`, so a caller can recompute it and
 * compare against the cache (districtLandValue.test.ts does).
 */
export function districtLandValue(state: GameState, d: District, index?: HomeIndex): number {
  return landValueFromIndex(index ?? buildHomeIndex(state), districtCentre(d));
}

export function runDistrictSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;
  const town = townOf(state, ctx.townId);
  const ids = Object.keys(town.districts).sort();
  if (ids.length === 0) return;

  const homes = new Map<string, number>();
  const jobs = new Map<string, number>();
  const shops = new Map<string, number>();
  let totalHomes = 0;
  let totalJobs = 0;
  let totalShops = 0;

  for (const fid of Object.keys(town.facilities).sort()) {
    const fac = town.facilities[fid]!;
    const d = districtAt(town.districts, fac.location.x, fac.location.y);
    if (!d) continue;
    if (fac.type === 'home') {
      homes.set(d.id, (homes.get(d.id) ?? 0) + 1);
      totalHomes += 1;
    } else if (fac.status !== 'closed') {
      jobs.set(d.id, (jobs.get(d.id) ?? 0) + fac.employees.length);
      totalJobs += fac.employees.length;
      if (fac.type === 'retail' && fac.employees.length > 0) {
        shops.set(d.id, (shops.get(d.id) ?? 0) + 1);
        totalShops += 1;
      }
    }
  }

  // One home snapshot shared across every district's land-value sample, so the
  // daily aggregate is a single O(homes) sweep instead of O(districts × homes).
  // Town-scoped: the partner's districts sample the PARTNER's homes (ctx.townId).
  const homeIndex = buildHomeIndex(state, ctx.townId);
  for (const id of ids) {
    const d = town.districts[id]!;
    const homeShare = totalHomes > 0 ? (homes.get(id) ?? 0) / totalHomes : 0;
    const jobShare = totalJobs > 0 ? (jobs.get(id) ?? 0) / totalJobs : 0;
    const shopShare = totalShops > 0 ? (shops.get(id) ?? 0) / totalShops : 0;
    d.desirability = clamp(
      (0.4 * homeShare + 0.35 * jobShare + 0.25 * shopShare) * d.landValueBase,
      0,
      1,
    );
    d.landValue = landValueFromIndex(homeIndex, districtCentre(d));
  }
}
