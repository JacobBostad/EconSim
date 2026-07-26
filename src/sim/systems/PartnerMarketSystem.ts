/**
 * PartnerMarketSystem — the LIVE partner's supply side (Arc E step 4, slice 5).
 *
 * With the stub `TradeCityPool` retired for the graduated partner, its export
 * larder is now REAL retail-shelf stock. The crowd drains that shelf every day
 * (RetailDemandSystem, tier-correct). This system is the OTHER half of the pool's
 * `updatePools` logic, moved onto the real shelf: the port's OWN production plus a
 * gap-import tender refill the shelf toward the target cover buffer, so in steady
 * state the shelf hovers at `TRADE_POOL_TARGET_COVER_DAYS × demand` and the export
 * quote sits on the walk — while a SHOCK (a drained larder, or a dumped overhang)
 * moves cover, and thus the quote, exactly as a real inventory swing would.
 *
 *   supply = localProd + max(0, demand − localProd + (target − shelf)·REPLENISH)·throttle
 *
 * where `demand` is the partner's REAL recent daily sales (so it is tier-correct:
 * a product the crowd never buys reports zero demand → zero supply → a static
 * shelf → a bare-walk quote, no glut), `localProd` is the port's production
 * fraction of that (`productionByProduct`), `target = TRADE_POOL_TARGET_COVER_DAYS
 * × demand`, and a pre-announced TENDER throttles the imports (the headline shock
 * bites through real cover). At equilibrium (shelf = target, no tender) supply =
 * demand, so the crowd's drain is exactly replaced and the shelf holds — the same
 * negative-feedback stabilizer the pool had, now on real stock. The `target −
 * shelf` term self-corrects any seed-ramp or demand-vs-sales mismatch back to the
 * buffer, which is what bounds the quote over a long soak.
 *
 * Runs ONLY for a live partner town (it is in `PARTNER_SYSTEMS`, which only the
 * partner's scheduler pass executes, and is gated on `isLivePartnerCity`). It
 * moves STOCK only — no money (the port's supply is cash-free, the pool's
 * invariant) and no shared rng (a deterministic function of the real book).
 * Absent the flag there is no partner town, so it never runs and every pinned
 * baseline is untouched.
 */

import type { SimContext } from '../core/GameState';
import { townOf } from '../core/Town';
import { isDayBoundary } from '../core/Tick';
import { getProduct } from '../data/products';
import { getQuantity, addStock } from '../entities/Inventory';
import {
  TRADE_POOL_TARGET_COVER_DAYS,
  TRADE_POOL_REPLENISH_RATE,
  TRADE_POOL_SHORTAGE_THROTTLE,
} from '../data/constants';
import { localProductionFraction } from '../data/tradePool';
import { tradeAnnouncementMult } from './TradeAnnouncementSystem';
import { isLivePartnerCity, partnerDailyDemand } from '../core/PartnerMarket';

export function runPartnerMarketSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isDayBoundary(state.tick, ctx.config)) return;
  const cityId = ctx.townId;
  if (!isLivePartnerCity(state, cityId)) return;

  const town = townOf(state, cityId);
  // Sorted facility iteration (deterministic); refill each store's own products.
  for (const fid of Object.keys(town.facilities).sort()) {
    const store = town.facilities[fid]!;
    if (store.type !== 'retail') continue;
    for (const pid of store.retailProductIds) {
      const demand = partnerDailyDemand(state, cityId, pid);
      if (demand <= 0) continue; // no real crowd demand (ramp, or a luxury it won't buy)
      const localProd = localProductionFraction(cityId, pid) * demand;
      const target = TRADE_POOL_TARGET_COVER_DAYS * demand;
      const shelf = getQuantity(store.inputInventory, pid);
      const annMult = tradeAnnouncementMult(state, cityId, pid, ctx.time.day);
      const throttle = annMult > 1 ? TRADE_POOL_SHORTAGE_THROTTLE : 1;
      const imports =
        Math.max(0, demand - localProd + (target - shelf) * TRADE_POOL_REPLENISH_RATE) * throttle;
      addStock(store.inputInventory, pid, localProd + imports, getProduct(pid).defaultQuality);
    }
  }
}
