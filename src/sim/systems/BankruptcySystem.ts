/**
 * BankruptcySystem — monitors firm solvency once per day.
 *
 * A firm whose cash stays negative past the grace period becomes 'distressed'
 * (it slashes prices to liquidate stock and stops expanding). If it stays
 * insolvent long enough it becomes 'insolvent' and begins closing its costliest
 * facilities to cut losses. The player firm is never deleted — it only receives
 * escalating warnings and the same automatic cost-cutting, leaving room to
 * recover. Returning to non-negative cash restores 'healthy' status.
 */

import type { SimContext } from '../core/GameState';
import { emitEvent, reindexContracts } from '../core/GameState';
import { isDayBoundary } from '../core/Tick';
import { getProduct } from '../data/products';
import { tradeShares } from '../core/Shares';
import { sellFacility } from '../core/Demolition';
import { fireCitizen } from './LaborSystem';

export function runBankruptcySystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state, config } = ctx;

  // Arc B2 (city-scale only): a distressed AI liquidates its portfolio before
  // shuttering facilities — stakes are its most liquid asset, and a real
  // operator sells them first. Gated to keep the Village bankruptcy path
  // bit-identical; the player's portfolio is never force-sold (its owner
  // decides). Village AI rarely holds equity anyway, but the gate makes the
  // baseline invariance structural, not empirical.
  const cityScale = state.config.sizePreset !== 'village';

  for (const fid in state.firms) {
    const firm = state.firms[fid]!;
    if (firm.ownerType !== 'player' && firm.ownerType !== 'ai') continue;

    if (firm.cash >= 0) {
      if (firm.bankruptcyStatus !== 'healthy') {
        emitEvent(
          state,
          'success',
          'finance',
          `${firm.name} has recovered to solvency.`,
          firm.id,
        );
      }
      firm.daysInsolvent = 0;
      firm.bankruptcyStatus = 'healthy';
      continue;
    }

    firm.daysInsolvent += 1;

    // Liquid assets first: a troubled AI sells its stakes at market before any
    // facility is touched (city-scale only — see the gate above).
    const sellPortfolio = cityScale && firm.ownerType === 'ai';

    if (firm.daysInsolvent >= config.insolvencyCloseDays) {
      firm.bankruptcyStatus = 'insolvent';
      // Distress ladder, liquid-first: sell the portfolio, then sell the
      // least-productive facility at market (recovering 50% of its book, plus
      // salvaged stock), and only CLOSE a facility — which recovers nothing —
      // if the firm is still underwater. Each rung can lift cash back to solvent
      // and stop the ladder, the reprieve a real operator earns by shedding
      // assets instead of shuttering them. City-scale AI only (see the gate).
      if (sellPortfolio) liquidatePortfolio(ctx, firm.id);
      if (sellPortfolio && firm.cash < 0) sellLeastProductiveFacility(ctx, firm.id);
      if (firm.cash < 0) closeCostliestFacility(ctx, firm.id);
    } else if (firm.daysInsolvent >= config.distressGraceDays) {
      if (firm.bankruptcyStatus !== 'distressed') {
        emitEvent(
          state,
          'danger',
          'finance',
          `${firm.name} is distressed (cash ${firm.cash}). Cutting prices to liquidate.`,
          firm.id,
        );
      }
      firm.bankruptcyStatus = 'distressed';
      liquidate(ctx, firm.id);
      if (sellPortfolio) liquidatePortfolio(ctx, firm.id);
    }
  }
}

/**
 * Sell every stake the firm holds, at market, in sorted order (determinism).
 * Each sale runs the full tradeShares path — 3% fee, price impact, realized
 * P&L against cost basis, money conserved. Returns true if anything sold.
 */
function liquidatePortfolio(ctx: SimContext, firmId: string): boolean {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  const targets = Object.keys(firm.sharesHeld).sort();
  if (targets.length === 0) return false;
  emitEvent(
    state,
    'warning',
    'finance',
    `${firm.name} is selling its share portfolio to raise cash.`,
    firm.id,
  );
  let sold = false;
  for (const tid of targets) {
    const pct = firm.sharesHeld[tid] ?? 0;
    if (pct <= 0) continue;
    if (tradeShares(state, firmId, tid, -pct)) sold = true;
  }
  return sold;
}

/**
 * Sell the firm's single least-productive facility at market (the 50% refund
 * plus salvaged stock), sorted-deterministic on a tie. "Least productive" is
 * the worst 7-day EMA net — the money pit, not merely the priciest to run
 * (that's the CLOSE heuristic). Selling recovers cash where closing recovers
 * nothing, so a distressed AI reaches for it first. No buyer exists — the sale
 * refunds from the world account, not another firm — so it can never feed a
 * sell-then-buy loop with any AI expansion path. Player firms never reach here
 * (the caller gates on ownerType === 'ai'). Returns true if a facility sold.
 */
function sellLeastProductiveFacility(ctx: SimContext, firmId: string): boolean {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  let target: string | null = null;
  let worst = Infinity;
  for (const facId of [...firm.facilities].sort()) {
    const fac = state.facilities[facId];
    if (!fac || fac.status === 'closed') continue;
    // Shed machinery, not housing: the importer is never an asset, and selling
    // a home would displace its residents (a distress firm dumping tenants onto
    // the street would ripple through satisfaction/immigration) — closing never
    // touches homes either, so the fire-sale ladder stays symmetric with it.
    if (fac.type === 'importer' || fac.type === 'home') continue;
    if (fac.pnlEma.net < worst) {
      worst = fac.pnlEma.net;
      target = facId;
    }
  }
  if (!target) return false;
  return sellFacility(state, firmId, target);
}

function liquidate(ctx: SimContext, firmId: string): void {
  const firm = ctx.state.firms[firmId]!;
  for (const pid in firm.pricesByProduct) {
    const base = getProduct(pid).basePrice;
    firm.pricesByProduct[pid] = Math.max(
      Math.round(base * 0.7),
      Math.round((firm.pricesByProduct[pid] ?? base) * 0.95),
    );
  }
}

function closeCostliestFacility(ctx: SimContext, firmId: string): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  let target: string | null = null;
  let worst = -1;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.status === 'closed') continue;
    if (fac.operatingCostPerDay > worst) {
      worst = fac.operatingCostPerDay;
      target = facId;
    }
  }
  if (!target) return;
  // REPOSSESSION RUNG (Arc D2 / HD4): if the facility the insolvency ladder
  // would CLOSE is a LEASED premises, it reverts to its landlord instead of
  // shuttering — the tenant never owned it, so the landlord (which fronted the
  // build capital) recovers its asset. Reached identically on the player path
  // (this same function is the only insolvency close-point for player and AI).
  if (repossessLeasedFacility(ctx, firmId, target)) return;
  const fac = state.facilities[target]!;
  for (const cid of [...fac.employees]) fireCitizen(state, target, cid);
  fac.status = 'closed';
  fac.bottleneckReason = 'Closed (insolvency cost-cutting)';
  fac.activeRecipeId = fac.type === 'retail' ? fac.activeRecipeId : null;
  emitEvent(
    state,
    'danger',
    'finance',
    `${firm.name} closed ${fac.name} to cut losses.`,
    firm.id,
  );
}

/**
 * Repossession rung (Arc D2 / HD4). When the facility the insolvency ladder
 * would close is a LEASED premises (`landlordFirmId` set), the landlord takes
 * it back rather than the tenant shuttering it. Ownership transfers ON-BOOK and
 * NO money moves: the tenant loses premises it never paid for (the landlord
 * fronted the build capital), and the landlord recovers its asset — the
 * stranded-asset hole the D2 review flagged, now closed. Mirrors
 * performAcquisition's single-facility absorb, kept minimal: release the crew,
 * drop the tenant's supply lines into/out of the premises, move the facility to
 * the landlord's book, and clear the lease so it is plainly landlord-owned.
 * Returns true if the facility was repossessed (the caller then skips the close).
 *
 * Deterministic and conserved: a leased premises exists only when the
 * real-estate channel is on, so this whole rung is inert in every pinned run
 * (no leases flag-off ⇒ `landlordFirmId` is never set ⇒ this returns false).
 */
function repossessLeasedFacility(ctx: SimContext, tenantId: string, facilityId: string): boolean {
  const { state } = ctx;
  const fac = state.facilities[facilityId];
  if (!fac) return false;
  const landlordId = fac.landlordFirmId;
  // Not a lease, or a self-lease shell (never billed; nothing to hand back).
  if (landlordId === undefined || landlordId === tenantId) return false;
  const landlord = state.firms[landlordId];
  const tenant = state.firms[tenantId];
  if (!landlord || !tenant) return false;

  // Crew back to the labor pool (fireCitizen cleans both employee lists).
  for (const cid of [...fac.employees]) fireCitizen(state, facilityId, cid);

  // Drop the tenant's supply lines touching the lost premises. A THIRD firm's
  // inbound contract that merely sources from here is redirected to the
  // importer instead of severed — the sellFacility idiom (Demolition.ts), so a
  // rival's chain never silently loses its supply line to someone else's
  // repossession (review note: the first cut deleted them).
  const importer = Object.values(state.facilities).find((f) => f.type === 'importer');
  for (const ctrId of Object.keys(state.contracts).sort()) {
    const c = state.contracts[ctrId]!;
    if (c.destinationFacilityId === facilityId) {
      delete state.contracts[ctrId];
    } else if (c.sourceFacilityId === facilityId) {
      if (c.ownerFirmId !== tenantId && importer) c.sourceFacilityId = importer.id;
      else delete state.contracts[ctrId];
    }
  }
  // The shared per-tick contract index still buckets the deleted/re-keyed ids —
  // rebuild before any later same-tick reader walks a stale entry (the
  // ContractIndex maintenance contract; review note).
  reindexContracts(ctx);

  // Move the asset onto the landlord's book and clear the lease: it is now a
  // plainly landlord-owned facility (owned = operated by the engine's keying).
  tenant.facilities = tenant.facilities.filter((id) => id !== facilityId);
  fac.ownerFirmId = landlordId;
  if (!landlord.facilities.includes(facilityId)) landlord.facilities.push(facilityId);
  delete fac.landlordFirmId;
  delete fac.rentPerDay;

  emitEvent(
    state,
    'warning',
    'finance',
    `${landlord.name} repossessed ${fac.name} from ${tenant.name} after its insolvency.`,
    landlordId,
  );
  // Landlord-side tally for the landlord_repossession achievement: the player
  // fronted a premises' capital and got the asset back when its tenant folded.
  // Only when the PLAYER is the collecting landlord; inert flag-off (no leases).
  if (landlordId === state.playerFirmId) state.landlordRepossessions += 1;
  return true;
}
