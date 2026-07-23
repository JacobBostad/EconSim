/**
 * CommercialRentSystem — the commercial-lease revenue loop (Arc D2, HD4 item 3).
 *
 * A firm may LEASE its premises from a property firm instead of buying the
 * building outright: "lease for $X/day instead of $Y upfront". The landlord
 * fronted the build capital and carries the asset; the operator runs its
 * business on the premises and pays rent every day. This system moves that
 * rent — one transaction per leased facility, operator → landlord, booked as
 * `rentExpense` on the operator and `revenue` on the landlord (via the
 * transaction counterparty), so the cash CIRCULATES firm-to-firm and never
 * leaks to the world account. Conserved to the cent.
 *
 * Runs daily, right after the residential rent systems and before Accounting
 * snapshots the day (so the bill lands in the same `today` accumulators). Every
 * step is a deterministic sorted read — no rng — so the shared stream is never
 * perturbed. A town with no leased premises (Village always; plain city with
 * nobody leasing) takes no money path: the loop finds no facility with a
 * `landlordFirmId` and returns having done nothing, exactly as RentSystem does
 * with no apartments.
 *
 * SELF-LEASE GUARD (defense in depth — the build/lease command already blocks
 * it): a facility whose `landlordFirmId` equals its `ownerFirmId` would move
 * money from a firm to itself, minting nothing but polluting both ledgers, so
 * it is skipped here too. A firm cannot pay itself rent.
 */

import type { SimContext } from '../core/GameState';
import { recordTransaction } from '../core/GameState';
import { townOf } from '../core/Town';
import { firmAccount } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';

export function runCommercialRentSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isDayBoundary(state.tick, ctx.config)) return;
  const town = townOf(state, ctx.townId);

  // Sorted iteration keeps the ledger order deterministic across runs.
  for (const fid of Object.keys(state.facilities).sort()) {
    const fac = state.facilities[fid]!;
    const landlordId = fac.landlordFirmId;
    const rent = fac.rentPerDay ?? 0;
    if (!landlordId || rent <= 0) continue;
    if (fac.status === 'closed') continue;
    const tenantId = fac.ownerFirmId;
    if (landlordId === tenantId) continue; // self-lease guard
    const tenant = town.firms[tenantId];
    const landlord = town.firms[landlordId];
    if (!tenant || !landlord) continue;
    // A tenant that can't cover the day's rent skips it (arrears aren't modeled;
    // a chronically broke operator is BankruptcySystem's problem, not an
    // eviction here). No transfer ⇒ nothing to conserve.
    if (tenant.cash < rent) continue;

    recordTransaction(state, {
      from: firmAccount(tenantId),
      to: firmAccount(landlordId),
      amount: rent,
      firmId: tenantId,
      category: 'rentExpense',
      // The operator's rent is the landlord's revenue — the money circulates
      // firm-to-firm, exactly like a B2B service fee.
      counterparty: { firmId: landlordId, category: 'revenue' },
      note: `Lease rent: ${fac.name}`,
    });
    // No facility-level revenue credit: the premises is the TENANT's operating
    // facility (its `dailyStats.revenue` is the tenant's sales), so the
    // landlord's rent income lives at the firm level only, via the counterparty
    // revenue booking above.
  }
}
