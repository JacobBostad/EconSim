/**
 * WorldEventSystem — starts and ends world events (booms, droughts, fads...).
 *
 * Once per in-game day:
 *   1. Expire events whose endDay has arrived (with a closing news item).
 *   2. If fewer than MAX_ACTIVE_WORLD_EVENTS are running, roll the daily
 *      chance; on success, weighted-pick a candidate whose exclusiveGroup is
 *      not already active and whose grace period has passed, roll a duration,
 *      and announce it in the event log.
 *
 * Everything uses the seeded rng, so a given seed always produces the same
 * news history. Effects are applied by other systems via the pure helpers in
 * data/worldEvents.ts — this system only manages the active list.
 */

import type { SimContext } from '../core/GameState';
import { emitEvent } from '../core/GameState';
import { isDayBoundary } from '../core/Tick';
import {
  WORLD_EVENT_DEFS,
  getWorldEventDef,
  WORLD_EVENT_DAILY_CHANCE,
  MAX_ACTIVE_WORLD_EVENTS,
  type WorldEventDef,
} from '../data/worldEvents';

export function runWorldEventSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isDayBoundary(state.tick, ctx.config)) return;
  const day = ctx.time.day;

  // 1) Expire finished events.
  const stillActive: typeof state.worldEvents = [];
  for (const ev of state.worldEvents) {
    const def = getWorldEventDef(ev.defId);
    if (day >= ev.endDay) {
      if (def) {
        emitEvent(state, 'info', 'economy', `${def.icon} ${def.name} has ended — conditions return to normal.`);
      }
    } else {
      stillActive.push(ev);
    }
  }
  state.worldEvents = stillActive;

  // 2) Maybe start a new one.
  if (state.worldEvents.length >= MAX_ACTIVE_WORLD_EVENTS) return;
  if (!ctx.rng.chance(WORLD_EVENT_DAILY_CHANCE)) return;

  const activeGroups = new Set(
    state.worldEvents
      .map((ev) => getWorldEventDef(ev.defId)?.exclusiveGroup)
      .filter((g): g is string => g !== undefined),
  );
  const candidates = WORLD_EVENT_DEFS.filter(
    (d) => day >= d.earliestDay && !activeGroups.has(d.exclusiveGroup),
  );
  if (candidates.length === 0) return;

  const picked = weightedPick(ctx, candidates);
  if (!picked) return;

  const duration = ctx.rng.int(picked.minDays, picked.maxDays);
  state.worldEvents.push({ defId: picked.id, startDay: day, endDay: day + duration });
  emitEvent(
    state,
    picked.severity,
    'economy',
    `${picked.icon} ${picked.headline} (expected to last ~${duration} days)`,
  );
}

function weightedPick(ctx: SimContext, defs: WorldEventDef[]): WorldEventDef | undefined {
  let total = 0;
  for (const d of defs) total += d.weight;
  if (total <= 0) return undefined;
  let roll = ctx.rng.next() * total;
  for (const d of defs) {
    roll -= d.weight;
    if (roll < 0) return d;
  }
  return defs[defs.length - 1];
}
