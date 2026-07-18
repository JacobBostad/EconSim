/**
 * ImmigrationSystem — the town grows when it prospers.
 *
 * Once per day: if average satisfaction is high and almost everyone has a job,
 * word spreads and new citizens move in (up to hard caps). The municipality
 * builds a new home when housing is full, and each arrival brings starting cash
 * paid from the world account (so total money supply is conserved — the money
 * "arrives with them" from outside).
 *
 * Growth is the long-run reward loop: a well-run economy attracts people, which
 * grows demand and the labor pool, which enables further expansion.
 */

import type { SimContext } from '../core/GameState';
import { recordTransaction, emitEvent } from '../core/GameState';
import { citizenAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import { createFacility, createCitizen } from '../entities/factories';
import {
  IMMIGRATION_MIN_SATISFACTION,
  IMMIGRATION_MAX_UNEMPLOYED_FLOOR,
  IMMIGRATION_MAX_UNEMPLOYED_RATE,
  IMMIGRANT_START_CASH,
} from '../data/constants';

/**
 * Deterministic slot for the i-th home built beyond the starting 20, laid in
 * 20-home blocks: east of the starting block first, then southern rows on
 * taller (Bustling) maps. Null when the map has no room left.
 */
export function homeSlotFor(index: number, mapHeight: number): { x: number; y: number } | null {
  const block = Math.floor(index / 20);
  const within = index % 20;
  const col = within % 5;
  const row = Math.floor(within / 5);
  let baseX: number;
  let baseY: number;
  if (block === 0) {
    baseX = 76; baseY = 60;
  } else {
    const pair = Math.floor((block - 1) / 2);
    baseX = (block - 1) % 2 === 0 ? 16 : 76;
    baseY = 92 + pair * 32;
  }
  const y = baseY + row * 8;
  if (y > mapHeight - 4) return null;
  return { x: baseX + col * 11, y };
}

export function runImmigrationSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state, rng } = ctx;

  // Conditions: prosperous and labor-tight.
  let total = 0;
  let satisfactionSum = 0;
  let unemployed = 0;
  for (const cid in state.citizens) {
    const c = state.citizens[cid]!;
    total += 1;
    satisfactionSum += c.satisfaction;
    if (c.employmentStatus === 'unemployed') unemployed += 1;
  }
  if (total === 0 || total >= ctx.config.maxCitizens) return;
  if (satisfactionSum / total < IMMIGRATION_MIN_SATISFACTION) return;
  const maxUnemployed = Math.max(
    IMMIGRATION_MAX_UNEMPLOYED_FLOOR,
    Math.floor(total * IMMIGRATION_MAX_UNEMPLOYED_RATE),
  );
  if (unemployed > maxUnemployed) return;
  if (!rng.chance(0.4)) return; // organic pacing

  // Find a home with room, or build one in the new residential block.
  let homeId: string | null = null;
  let homes = 0;
  for (const fid in state.facilities) {
    const f = state.facilities[fid]!;
    if (f.type !== 'home') continue;
    homes += 1;
    if (homeId === null && f.residentIds.length < 2) homeId = fid;
  }
  if (homeId === null) {
    if (homes >= ctx.config.maxHomes) return;
    const slot = homeSlotFor(Math.max(0, homes - 20), ctx.config.mapHeight);
    if (!slot) return; // geographically full
    const home = createFacility(state, 'home', state.worldFirmId, slot, { name: `Home ${homes + 1}` });
    homeId = home.id;
    emitEvent(state, 'info', 'economy', `The town is growing — ${home.name} was built.`, home.id);
  }

  const cit = createCitizen(state, rng, homeId);
  recordTransaction(state, {
    from: WORLD_ACCOUNT,
    to: citizenAccount(cit.id),
    amount: IMMIGRANT_START_CASH,
    firmId: null,
    category: 'none',
    note: 'New arrival savings',
  });
  emitEvent(
    state,
    'success',
    'economy',
    `${cit.name} moved to town (population ${total + 1}).`,
    cit.id,
  );
}
