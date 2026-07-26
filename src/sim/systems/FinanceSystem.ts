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
import { formatMoney } from '../../utils/formatMoney';
import { recordTransaction, emitEvent } from '../core/GameState';
import { townOf } from '../core/Town';
import { firmAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import { SHARE_SHIFT_DECAY } from '../data/constants';
import { chargedInterestRatePerDay } from './interestRates';

export function runFinanceSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;
  const town = townOf(state, ctx.townId);

  // Share-price displacement mean-reverts toward fair value as the market
  // digests recent trades. Pure metadata — no cash moves. Sorted order for
  // determinism; near-zero displacements are dropped.
  for (const fid of Object.keys(state.sharePriceShift).sort()) {
    const next = state.sharePriceShift[fid]! * SHARE_SHIFT_DECAY;
    if (Math.abs(next) < 0.001) delete state.sharePriceShift[fid];
    else state.sharePriceShift[fid] = next;
  }
  for (const fid in town.firms) {
    const firm = town.firms[fid]!;
    if (firm.debt <= 0) continue;
    if (firm.ownerType !== 'player' && firm.ownerType !== 'ai') continue;
    // Flag OFF → the stored flat per-firm rate (byte-identical to pre-formula);
    // flag ON → the leverage-priced effective rate. See interestRates.ts.
    const interest = Math.round(firm.debt * chargedInterestRatePerDay(firm, state));
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
        emitEvent(state, 'warning', 'finance', `Interest of ${formatMoney(interest)} accrued while cash is negative.`, firm.id);
      }
    }
  }
}
