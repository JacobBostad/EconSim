/**
 * AchievementSystem — checks locked achievements once per in-game hour and
 * records unlocks in `state.achievements` (permanent; never re-locked).
 * Unlocks are announced in the event log; the UI shows a toast + Awards tab.
 */

import type { SimContext } from '../core/GameState';
import { emitEvent } from '../core/GameState';
import { isHourBoundary } from '../core/Tick';
import { ACHIEVEMENT_DEFS } from '../data/achievements';

export function runAchievementSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isHourBoundary(state.tick, ctx.config)) return;

  const unlocked = new Set(state.achievements.map((a) => a.id));
  for (const def of ACHIEVEMENT_DEFS) {
    if (unlocked.has(def.id)) continue;
    if (!def.check(state)) continue;
    state.achievements.push({ id: def.id, day: ctx.time.day });
    emitEvent(
      state,
      'success',
      'player',
      `${def.icon} Achievement unlocked: ${def.name} — ${def.description}`,
    );
  }
}
