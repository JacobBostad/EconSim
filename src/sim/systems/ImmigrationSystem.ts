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
 *
 * The loop also runs in reverse: a worker-heavy town held in deep misery past
 * a grace period starts losing households (see runEmigration below) — and one
 * good day stops the bleed.
 */

import type { SimContext, GameState } from '../core/GameState';
import type { Citizen } from '../entities/Citizen';
import { recordTransaction, emitEvent } from '../core/GameState';
import { townOf } from '../core/Town';
import { citizenAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import { createFacility, createCitizen } from '../entities/factories';
import { firstFreeDistrictSlot, type SlotSpec } from '../core/DistrictSlots';
import { removeCitizen } from './LaborSystem';
import {
  IMMIGRATION_MIN_SATISFACTION,
  IMMIGRATION_MAX_UNEMPLOYED_FLOOR,
  IMMIGRATION_MAX_UNEMPLOYED_RATE,
  IMMIGRANT_START_CASH,
  EMIGRATION_MAX_SATISFACTION,
  EMIGRATION_MIN_WORKER_SHARE,
  EMIGRATION_GRACE_DAYS,
  EMIGRATION_DAILY_CHANCE,
  EMIGRATION_MIN_POPULATION,
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

/** Home slot grid for City/Metropolis residential districts — the 11×8 spacing
 * the legacy Village blocks used, so density reads the same on the big maps. */
export const HOME_SLOT_SPEC: SlotSpec = { stepX: 11, stepY: 8, margin: 4, clearRadius: 6 };

/** Comfortable+affluent share above which newcomers arrive skilled. */
export const PROSPEROUS_SHARE = 0.4;
export const PROSPEROUS_SKILL_BONUS = 0.1;

/** Struggling worker towns mutter about leaving — the warning shot before
 * the real departures below. Hash-gated, no rng draws. */
export function emigrationMutter(seed: number, day: number): boolean {
  let t = (seed ^ Math.imul(day + 53, 0x9e3779b9)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 < 0.06;
}

/** Daily departure gate once misery has outlasted the grace period.
 * Distinct salt from the mutter — the two fire on independent days. */
export function emigrationRoll(seed: number, day: number): boolean {
  let t = (seed ^ Math.imul(day + 191, 0x85ebca6b)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 < EMIGRATION_DAILY_CHANCE;
}

/**
 * The mutter made real: after EMIGRATION_GRACE_DAYS consecutive days of a
 * worker-heavy, deeply unsatisfied town, one household starts packing —
 * unemployed first, then whoever is most miserable. Their savings leave with
 * them (paid back to the world account, the mirror of arrival cash, so money
 * stays conserved). One day above the bar resets the pressure to zero:
 * rescuing the town stops the bleed immediately.
 *
 * Returns true when someone departed. No rng draws — hash-gated so the
 * shared stream is untouched whether or not the town is miserable.
 */
function runEmigration(
  state: GameState,
  day: number,
  avgSat: number,
  workerShare: number,
  total: number,
): boolean {
  const miserable =
    avgSat < EMIGRATION_MAX_SATISFACTION && workerShare > EMIGRATION_MIN_WORKER_SHARE;
  if (!miserable) {
    state.emigrationPressure = 0;
    return false;
  }
  state.emigrationPressure += 1;
  if (state.emigrationPressure <= EMIGRATION_GRACE_DAYS) return false;
  if (total <= EMIGRATION_MIN_POPULATION) return false;
  if (!emigrationRoll(state.seed, day)) return false;

  // Unemployed leave first; among peers, the most miserable. Insertion
  // order breaks ties, so the pick is deterministic.
  // Bare-`state` helper mid-gradient: home town by default (one-town region →
  // same reference); gains a `townId` param at the endgame move.
  const citizens = townOf(state).citizens;
  let pick: Citizen | null = null;
  for (const cid in citizens) {
    const c = citizens[cid]!;
    if (pick === null) { pick = c; continue; }
    const cJobless = c.employmentStatus === 'unemployed';
    const pickJobless = pick.employmentStatus === 'unemployed';
    if (cJobless !== pickJobless) { if (cJobless) pick = c; continue; }
    if (c.satisfaction < pick.satisfaction) pick = c;
  }
  if (!pick) return false;
  const gone = pick;

  const wasJobless = gone.employmentStatus === 'unemployed';
  // Their savings leave with them (paid back to the world account, the mirror
  // of arrival cash). Shared removal path — see removeCitizen.
  removeCitizen(state, gone, WORLD_ACCOUNT, 'Departed with savings');
  state.emigrationDepartures += 1;

  const reason = wasJobless
    ? 'no work to be found'
    : 'low pay and thin shelves wore them down';
  emitEvent(state, 'warning', 'economy',
    `🧳 ${gone.name} packed up and left town — ${reason} (population ${total - 1}).`);
  return true;
}

export function runImmigrationSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state, rng } = ctx;
  const town = townOf(state, ctx.townId);

  // Conditions: prosperous and labor-tight.
  let total = 0;
  let satisfactionSum = 0;
  let unemployed = 0;
  let workers = 0;
  for (const cid in town.citizens) {
    const c = town.citizens[cid]!;
    total += 1;
    satisfactionSum += c.satisfaction;
    if (c.employmentStatus === 'unemployed') unemployed += 1;
    if (c.tier === 'worker') workers += 1;
  }
  if (total === 0) return;
  const avgSat = satisfactionSum / total;

  // Misery is checked before any growth gate — a full town can still bleed.
  if (runEmigration(state, ctx.time.day, avgSat, workers / total, total)) total -= 1;

  if (total >= ctx.config.maxCitizens) return;
  if (avgSat < IMMIGRATION_MIN_SATISFACTION) {
    // A struggling worker town doesn't just fail to attract — it mutters.
    if (avgSat < 50 && emigrationMutter(state.seed, ctx.time.day)) {
      if (workers / total > 0.8) {
        emitEvent(state, 'warning', 'economy',
          '🧳 Around kitchen tables, families talk of leaving — low pay and empty shelves wear a town down.');
      }
    }
    return;
  }
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
    // Village keeps the legacy column march EXACTLY (bit-identity contract — the
    // 300-day baseline pins these coordinates). City/Metropolis enumerate free
    // slots inside residential districts, so homes stay in shopping reach of the
    // commercial core instead of marching off the south edge (A4).
    const slot =
      ctx.config.sizePreset === 'village'
        ? homeSlotFor(Math.max(0, homes - 20), ctx.config.mapHeight)
        : firstFreeDistrictSlot(state, 'residential', HOME_SLOT_SPEC);
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

  // Prosperous towns attract talent: when the middle class is broad, word
  // of the good life reaches skilled tradespeople. Applied AFTER creation
  // so the shared rng stream is untouched (no new draws, same sequence).
  let climbed = 0;
  for (const cid in town.citizens) {
    if (town.citizens[cid]!.tier !== 'worker') climbed += 1;
  }
  const prosperous = total > 0 && climbed / total > PROSPEROUS_SHARE;
  if (prosperous) {
    cit.skill = Math.min(1.3, Math.round((cit.skill + PROSPEROUS_SKILL_BONUS) * 100) / 100);
    emitEvent(state, 'success', 'economy',
      `✨ Word of the good life here spreads — ${cit.name} arrives with a trade (population ${total + 1}).`, cit.id);
  } else {
    emitEvent(state, 'success', 'economy',
      `${cit.name} moved to town (population ${total + 1}).`, cit.id);
  }
}
