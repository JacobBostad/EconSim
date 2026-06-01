/**
 * TimeSystem — emits the "new day" marker event.
 *
 * Time itself is derived from the tick counter (see core/Tick.ts), so this
 * system only announces day rollovers. Per-day data resets are owned by the
 * systems that own that data (accounting, market stats, facility/citizen stats).
 */

import type { SimContext } from '../core/GameState';
import { emitEvent } from '../core/GameState';
import { isDayBoundary } from '../core/Tick';

export function runTimeSystem(ctx: SimContext): void {
  if (isDayBoundary(ctx.state.tick, ctx.config)) {
    emitEvent(ctx.state, 'info', 'system', `Day ${ctx.time.day} begins.`);
  }
}
