/**
 * DistrictSystem — daily district desirability cache (world-scale, HD6).
 *
 * Desirability blends what a district actually offers: homes (people want
 * neighbors), jobs (people want work nearby), and stocked shops (people want
 * full shelves). Pure state math — zero rng draws, sorted iteration — cached
 * on the district so cohort migration (A3) and district land value (A4) read
 * a number instead of re-scanning facilities.
 *
 * In A2 nothing consumes the cache yet: the system runs dark, cheap, and
 * deterministic, and the Districts panel displays it.
 */

import type { SimContext } from '../core/GameState';
import { isDayBoundary } from '../core/Tick';
import { districtAt } from '../entities/District';
import { clamp } from '../../utils/clamp';

export function runDistrictSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;
  const ids = Object.keys(state.districts).sort();
  if (ids.length === 0) return;

  const homes = new Map<string, number>();
  const jobs = new Map<string, number>();
  const shops = new Map<string, number>();
  let totalHomes = 0;
  let totalJobs = 0;
  let totalShops = 0;

  for (const fid of Object.keys(state.facilities).sort()) {
    const fac = state.facilities[fid]!;
    const d = districtAt(state.districts, fac.location.x, fac.location.y);
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

  for (const id of ids) {
    const d = state.districts[id]!;
    const homeShare = totalHomes > 0 ? (homes.get(id) ?? 0) / totalHomes : 0;
    const jobShare = totalJobs > 0 ? (jobs.get(id) ?? 0) / totalJobs : 0;
    const shopShare = totalShops > 0 ? (shops.get(id) ?? 0) / totalShops : 0;
    d.desirability = clamp(
      (0.4 * homeShare + 0.35 * jobShare + 0.25 * shopShare) * d.landValueBase,
      0,
      1,
    );
  }
}
