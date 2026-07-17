/**
 * MissionSystem — advances the guided mission chain (see data/missions.ts).
 *
 * Hourly, checks only the first incomplete mission; on success it records the
 * completion, pays the reward from the world account (conserved money), and
 * announces it. At most one mission completes per check so the chain reads as
 * a sequence of moments rather than a burst.
 */

import type { SimContext } from '../core/GameState';
import { emitEvent, recordTransaction } from '../core/GameState';
import { firmAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isHourBoundary } from '../core/Tick';
import { activeMission } from '../data/missions';
import { formatMoney } from '../../utils/formatMoney';

export function runMissionSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isHourBoundary(state.tick, ctx.config)) return;

  const mission = activeMission(state);
  if (!mission || !mission.check(state)) return;

  state.missions.push({ id: mission.id, day: ctx.time.day });
  recordTransaction(state, {
    from: WORLD_ACCOUNT,
    to: firmAccount(state.playerFirmId),
    amount: mission.reward,
    firmId: null, // reward is not P&L — keeps the books about operations
    category: 'none',
    note: `Mission reward: ${mission.name}`,
  });
  emitEvent(
    state,
    'success',
    'player',
    `${mission.icon} Mission complete: ${mission.name} — reward ${formatMoney(mission.reward)} paid.`,
  );
}
