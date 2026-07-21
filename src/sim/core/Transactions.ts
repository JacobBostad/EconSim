/**
 * Transactions.ts — Money movement records + the single money-transfer helper.
 *
 * Every cash movement in the simulation goes through `recordTransaction`, which
 * (1) moves money between accounts, (2) appends a bounded transaction record,
 * and (3) updates the affected firm's lifetime + today accounting accumulators.
 * Because the same helper does all three, firm books always reconcile with the
 * transaction history (see tests/accounting.test.ts).
 *
 * All amounts are positive integer cents. Accounts are firms, citizens, or the
 * single "world" account (utilities/government/outside world). Total money
 * across all citizens + firms + world is therefore conserved exactly.
 */

import type {
  TransactionId,
  FirmId,
  CitizenId,
  ProductId,
} from './Id';

export type AccountKind = 'firm' | 'citizen' | 'world' | 'cohort';

export interface AccountRef {
  kind: AccountKind;
  id: string | null; // firm/citizen/cohort id, or null for world
}

/**
 * Which firm ledger category this transaction affects, from the perspective of
 * the firm named in `firmId`. Determines how the firm's accounting updates.
 */
export type LedgerCategory =
  | 'revenue'
  | 'cogs'
  | 'wages'
  | 'maintenance'
  | 'logistics'
  | 'variableCost'
  | 'serviceExpense'
  | 'rentExpense'
  | 'marketing'
  | 'rnd'
  | 'interest'
  | 'loanDraw'
  | 'loanRepay'
  | 'buildSpend'
  | 'importPurchase'
  | 'dividendIn'
  | 'dividendOut'
  | 'shareBuy'
  | 'shareSell'
  | 'none';

export interface Transaction {
  id: TransactionId;
  tick: number;
  from: AccountRef;
  to: AccountRef;
  amount: number; // positive cents
  firmId: FirmId | null; // firm whose books this primarily affects
  category: LedgerCategory;
  productId: ProductId | null;
  quantity: number;
  note: string;
}

export function firmAccount(id: FirmId): AccountRef {
  return { kind: 'firm', id };
}
export function citizenAccount(id: CitizenId): AccountRef {
  return { kind: 'citizen', id };
}
export const WORLD_ACCOUNT: AccountRef = { kind: 'world', id: null };
export function cohortAccount(id: string): AccountRef {
  return { kind: 'cohort', id };
}
