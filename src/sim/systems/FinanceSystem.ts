/**
 * FinanceSystem — accrues daily interest on outstanding loan principal.
 *
 * Loans let a firm trade future cash for capital now (leverage). Interest is a
 * real finance cost paid to the world (bank) account each day; principal is
 * repaid via the REPAY_LOAN command. Heavy debt deepens insolvency, so leverage
 * is a genuine risk/reward lever. Taking/repaying loans is handled by commands;
 * this system only services the interest.
 */

import type { SimContext } from '../core/GameState';
import { recordTransaction, emitEvent } from '../core/GameState';
import { firmAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';

export function runFinanceSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;
  for (const fid in state.firms) {
    const firm = state.firms[fid]!;
    if (firm.debt <= 0) continue;
    if (firm.ownerType !== 'player' && firm.ownerType !== 'ai') continue;
    const interest = Math.round(firm.debt * firm.interestRatePerDay);
    if (interest <= 0) continue;
    recordTransaction(state, {
      from: firmAccount(firm.id),
      to: WORLD_ACCOUNT,
      amount: interest,
      firmId: firm.id,
      category: 'interest',
      note: 'Loan interest',
    });
    if (firm.ownerType === 'player') {
      // Quiet by default; only warn when interest is biting into negative cash.
      if (firm.cash < 0) {
        emitEvent(state, 'warning', 'finance', `Interest of ${interest}¢ accrued while cash is negative.`, firm.id);
      }
    }
  }
}
