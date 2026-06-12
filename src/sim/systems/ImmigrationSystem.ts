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
  MAX_HOMES,
  MAX_CITIZENS,
  IMMIGRANT_START_CASH,
} from '../data/constants';

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
  if (total === 0 || total >= MAX_CITIZENS) return;
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
    if (homes >= MAX_HOMES) return;
    const i = homes - 20; // index within the second (eastern) block
    const col = Math.max(0, i) % 5;
    const row = Math.floor(Math.max(0, i) / 5);
    const home = createFacility(state, 'home', state.worldFirmId, {
      x: 76 + col * 11,
      y: 60 + row * 8,
    }, { name: `Home ${homes + 1}` });
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
