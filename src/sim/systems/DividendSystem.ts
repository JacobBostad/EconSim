/**
 * DividendSystem — distributes a share of daily profits to shareholders.
 *
 * Runs at the day boundary BEFORE AccountingSystem resets the day's books.
 * Each firm with a positive net profit for the completed day pays out
 * DIVIDEND_PAYOUT_RATIO of it: holders of its shares receive their percentage,
 * and the remainder (the public float) goes to the world account. Dividends are
 * a profit distribution, not an operating expense, so they use the 'none'
 * ledger category (cash moves; P&L is untouched).
 *
 * This is what makes owning rival shares a real income strategy.
 */

import type { SimContext } from '../core/GameState';
import { formatMoney } from '../../utils/formatMoney';
import { recordTransaction, emitEvent } from '../core/GameState';
import { firmAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import { netProfit } from '../entities/Accounting';
import { DIVIDEND_PAYOUT_RATIO } from '../data/constants';

export function runDividendSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;

  for (const fid in state.firms) {
    const payer = state.firms[fid]!;
    if (payer.ownerType !== 'player' && payer.ownerType !== 'ai') continue;
    const profit = netProfit(payer.accounting.today);
    if (profit <= 0 || payer.cash <= 0) continue;
    const pool = Math.min(Math.round(profit * DIVIDEND_PAYOUT_RATIO), payer.cash);
    if (pool <= 0) continue;

    let paidToHolders = 0;
    for (const hid in state.firms) {
      if (hid === fid) continue;
      const holder = state.firms[hid]!;
      const pct = holder.sharesHeld[fid] ?? 0;
      if (pct <= 0) continue;
      const amount = Math.floor((pool * pct) / 100);
      if (amount <= 0) continue;
      paidToHolders += amount;
      recordTransaction(state, {
        from: firmAccount(fid),
        to: firmAccount(hid),
        amount,
        firmId: null,
        category: 'none',
        note: `Dividend from ${payer.name} (${pct}%)`,
      });
      if (hid === state.playerFirmId) {
        emitEvent(state, 'success', 'finance', `Received ${formatMoney(amount)} dividend from ${payer.name} (${pct}% stake).`, fid);
      }
    }
    // Public float's share leaves to the outside world.
    const publicShare = pool - paidToHolders;
    if (publicShare > 0) {
      recordTransaction(state, {
        from: firmAccount(fid),
        to: WORLD_ACCOUNT,
        amount: publicShare,
        firmId: null,
        category: 'none',
        note: `Dividend to public shareholders of ${payer.name}`,
      });
    }
  }
}
