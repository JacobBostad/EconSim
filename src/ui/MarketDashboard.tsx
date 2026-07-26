import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { marketRows } from '../sim/selectors/marketSelectors';
import { formatMoney } from '../utils/formatMoney';
import { FormulaTooltip } from './FormulaTooltip';
import { TrendCard } from './Sparkline';
import { CONSUMER_PRODUCT_IDS_BY_PRESET, getProduct } from '../sim/data/products';
import { pickBestCity } from '../sim/core/Trade';
import { getTradeCity } from '../sim/data/tradeCities';
import { wholesaleBoard } from '../sim/selectors/wholesaleSelectors';
import { townOf } from '../sim/core/Town';

export function MarketDashboard(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const state = sim.getState();
  // The dashboard renders the home town (one-town region → identical reference);
  // it gains a town selector at the endgame move.
  const town = townOf(state);
  const rows = marketRows(state, false);
  const playerId = state.playerFirmId;

  return (
    <div>
      <p className="muted small">
        Daily figures reset at midnight. Demand attempts inflate when goods are scarce (citizens
        retry). “Avg price” is sales-weighted across all stores.
      </p>
      <table>
        <thead>
          <tr>
            <th>Product</th><th>Base</th><th>Avg price</th>
            <th><FormulaTooltip title="Demand attempts" explanation="Shopping visits today, fulfilled or not.">Attempts</FormulaTooltip></th>
            <th>Fulfilled</th><th>Unmet</th><th>Units sold</th><th>Stockouts</th>
            <th>Avg quality</th><th>Total inventory</th>
            <th><FormulaTooltip title="Best export price" explanation="The better of Port Rosa 🚢 and Ironvale 🚂 today (Ironvale favors industry, discounts food, charges more freight). Export from a warehouse — shipments route to the best net price. Follows world events — droughts raise grain prices there too. Green = lucrative (≥1.3× base).">Export</FormulaTooltip></th>
            <th>Leader</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.productId}>
              <td>{r.name}</td>
              <td className="mono">{formatMoney(r.basePrice)}</td>
              <td className="mono">{r.averagePrice ? formatMoney(r.averagePrice) : '—'}</td>
              <td className="mono">{r.demandAttempts}</td>
              <td className="mono">{r.fulfilledDemand}</td>
              <td className="mono" style={{ color: r.unmetDemand > 0 ? 'var(--amber)' : undefined }}>{r.unmetDemand}</td>
              <td className="mono">{r.unitsSold}</td>
              <td className="mono">{r.stockoutCount}</td>
              <td className="mono">{r.averageQuality.toFixed(0)}</td>
              <td className="mono">{r.totalInventory}</td>
              {(() => {
                const best = pickBestCity(state, r.productId);
                const mult = best.price / r.basePrice;
                return (
                  <td
                    className="mono"
                    title={`Best export price today: ${getTradeCity(best.cityId).name}`}
                    style={{ color: mult >= 1.3 ? 'var(--green)' : mult <= 0.75 ? 'var(--red)' : undefined }}
                  >
                    {getTradeCity(best.cityId).emoji}{formatMoney(best.price)}
                  </td>
                );
              })()}
              <td>{r.topFirmName ? `${r.topFirmName} ${(r.topFirmShare * 100).toFixed(0)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Wholesale board</h3>
      {(() => {
        const board = wholesaleBoard(state);
        if (board.length === 0) {
          return (
            <p className="muted small">
              No wholesale sellers yet. Any producing facility with surplus (and
              wholesale enabled) appears here — undercut the cheapest row and AI
              buyers come to you.
            </p>
          );
        }
        return (
          <>
            <p className="muted small">
              Suppliers sorted cheapest-first per product. AI buyers take the
              cheapest qualifying row, defect to anyone 10%+ cheaper than their
              current supplier, and walk when a price beats importing no longer.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Product</th><th>Supplier</th><th>Asking</th>
                  <th><FormulaTooltip title="Unit price" explanation="Asking % × today's market average (base price when the product has no retail market).">Unit</FormulaTooltip></th>
                  <th><FormulaTooltip title="Importer benchmark" explanation="Base price × 1.5 import markup (× world events). The bar every local price is judged against.">vs importer</FormulaTooltip></th>
                  <th>Surplus</th><th>Customers</th>
                </tr>
              </thead>
              <tbody>
                {board.flatMap((p) =>
                  p.rows.map((r, i) => (
                    <tr key={r.facilityId + p.productId} style={r.isPlayer ? { color: 'var(--accent, #58a6ff)' } : undefined}>
                      <td>{i === 0 ? p.productName : ''}</td>
                      <td>{r.facilityName} · {r.firmName}{r.isPlayer ? ' (you)' : ''}</td>
                      <td className="mono">{Math.round(r.mult * 100)}%</td>
                      <td className="mono">{formatMoney(r.unitPrice)}</td>
                      <td className="mono" style={{ color: r.unitPrice < p.importerUnit ? 'var(--green)' : 'var(--red)' }}>
                        {formatMoney(p.importerUnit)}
                      </td>
                      <td className="mono">{r.surplus}</td>
                      <td className="mono">{r.customers}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </>
        );
      })()}

      <h3>Trends (last 60 days)</h3>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {CONSUMER_PRODUCT_IDS_BY_PRESET[state.config.sizePreset].map((pid) => {
          const stat = town.marketStats[pid];
          const hist = (stat?.history ?? []).slice(-60);
          if (hist.length < 2) return null;
          const name = getProduct(pid).name;
          const lastPrice = hist[hist.length - 1]!.averagePrice;
          const lastShare = hist[hist.length - 1]!.sharesByFirm[playerId] ?? 0;
          return (
            <React.Fragment key={pid}>
              <TrendCard
                label={`${name} — avg price`}
                latest={lastPrice ? formatMoney(lastPrice) : '—'}
                points={hist.map((h) => h.averagePrice)}
                color="var(--amber)"
              />
              <TrendCard
                label={`${name} — your share`}
                latest={`${(lastShare * 100).toFixed(0)}%`}
                points={hist.map((h) => (h.sharesByFirm[playerId] ?? 0) * 100)}
                color="var(--accent)"
              />
              <TrendCard
                label={`${name} — unmet demand`}
                latest={String(hist[hist.length - 1]!.unmetDemand)}
                points={hist.map((h) => h.unmetDemand)}
                color="var(--red)"
              />
              <TrendCard
                label={`${name} — best export quote`}
                latest={formatMoney(hist[hist.length - 1]!.tradePrice)}
                points={hist.map((h) => h.tradePrice)}
                color="var(--purple, #d2a8ff)"
              />
            </React.Fragment>
          );
        })}
      </div>
      {CONSUMER_PRODUCT_IDS_BY_PRESET[state.config.sizePreset].every((pid) => (town.marketStats[pid]?.history ?? []).length < 2) && (
        <p className="muted small">Trend charts appear after a couple of in-game days.</p>
      )}
    </div>
  );
}
