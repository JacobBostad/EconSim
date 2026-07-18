/**
 * FacilityModal — inline facility configuration + action controls.
 *
 * Exposes the player's operational levers for a facility they own: choose a
 * production recipe, set the retail product and price, hire/fire workers, create
 * supply contracts, and buy inputs from the importer. Read-only for facilities
 * owned by other firms.
 */

import React, { useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import type { Facility } from '../sim/entities/Facility';
import { getFacilityDef } from '../sim/data/facilityDefinitions';
import { getRecipe } from '../sim/data/recipes';
import { getProduct, ALL_PRODUCT_IDS } from '../sim/data/products';
import { facilityEmployees } from '../sim/selectors/facilitySelectors';
import { contractsByDestination } from '../sim/selectors/supplyChainSelectors';
import { getQuantity } from '../sim/entities/Inventory';
import { formatMoney } from '../utils/formatMoney';
import { CENTS, WHOLESALE_DISCOUNT } from '../sim/data/constants';
import { WHOLESALE_MULT_MIN, WHOLESALE_MULT_MAX } from '../sim/core/Wholesale';
import { upgradeCost } from '../sim/core/Upgrades';
import { sellRefund } from '../sim/core/Demolition';
import { pricingInsight } from '../sim/selectors/marketSelectors';
import { pickBestCity, cityPrice } from '../sim/core/Trade';
import { TRADE_CITY_IDS, getTradeCity } from '../sim/data/tradeCities';

export function FacilityActions({ fac }: { fac: Facility }): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const dispatch = useGameStore((s) => s.dispatch);
  const state = sim.getState();
  const isPlayer = fac.ownerFirmId === state.playerFirmId;
  const firm = state.firms[fac.ownerFirmId];
  const def = getFacilityDef(fac.defId);
  const employees = facilityEmployees(state, fac.id);

  const [src, setSrc] = useState('');
  const [ctrProduct, setCtrProduct] = useState('');
  const [reorder, setReorder] = useState(20);
  const [target, setTarget] = useState(40);
  const [maxInv, setMaxInv] = useState(80);
  const [importProduct, setImportProduct] = useState('grain');
  const [importQty, setImportQty] = useState(20);

  const producing = fac.type === 'farm' || fac.type === 'mine' || fac.type === 'factory';
  const sellValue = isPlayer ? sellRefund(state, fac.ownerFirmId, fac.id) : null;

  return (
    <div>
      {/* Recipe selection */}
      {producing && (
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>Production Recipe</div>
          {isPlayer ? (
            <select
              value={fac.activeRecipeId ?? ''}
              onChange={(e) =>
                dispatch({
                  type: 'SELECT_RECIPE',
                  facilityId: fac.id,
                  recipeId: e.target.value || null,
                })
              }
            >
              <option value="">— none —</option>
              {fac.recipes.map((rid) => (
                <option key={rid} value={rid}>{getRecipe(rid).name}</option>
              ))}
            </select>
          ) : (
            <div className="small">{fac.activeRecipeId ? getRecipe(fac.activeRecipeId).name : 'none'}</div>
          )}
          {fac.activeRecipeId && <RecipeInfo recipeId={fac.activeRecipeId} />}
        </div>
      )}

      {/* Wholesale: seller-side controls for facilities that can hold stock */}
      {isPlayer && (producing || fac.type === 'warehouse') && (
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>🤝 Wholesale</div>
          <label className="small row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={fac.wholesaleEnabled !== false}
              onChange={(e) =>
                dispatch({ type: 'TOGGLE_WHOLESALE', facilityId: fac.id, enabled: e.target.checked })
              }
            />
            Sell surplus to other firms (paid per shipment)
          </label>
          {fac.wholesaleEnabled !== false && (() => {
            const mult = fac.wholesalePriceMult ?? WHOLESALE_DISCOUNT;
            const pct = Math.round(mult * 100);
            return (
              <div className="small row" style={{ gap: 6, marginTop: 4, alignItems: 'center' }}>
                <span>Your price: <strong>{pct}%</strong> of market</span>
                <button
                  disabled={mult <= WHOLESALE_MULT_MIN + 1e-9}
                  onClick={() => dispatch({ type: 'SET_WHOLESALE_PRICE', facilityId: fac.id, mult: mult - 0.05 })}
                >−5%</button>
                <button
                  disabled={mult >= WHOLESALE_MULT_MAX - 1e-9}
                  onClick={() => dispatch({ type: 'SET_WHOLESALE_PRICE', facilityId: fac.id, mult: mult + 0.05 })}
                >+5%</button>
                <span className="muted">
                  {pct < 70
                    ? 'undercutting — first pick for AI buyers'
                    : pct <= 80
                      ? 'AI switches only when this clearly beats importing'
                      : 'pricey — customers walk if importing is cheaper'}
                </span>
              </div>
            );
          })()}
          {(() => {
            const customers = Object.values(state.contracts).filter(
              (c) => c.active && c.sourceFacilityId === fac.id
                && state.facilities[c.destinationFacilityId]?.ownerFirmId !== fac.ownerFirmId,
            );
            if (customers.length === 0) {
              return (
                <p className="muted small" style={{ margin: '4px 0 0' }}>
                  No wholesale customers. Keep a surplus here and AI firms whose
                  imports cost more will come to you. Turn it off to protect an
                  export stockpile.
                </p>
              );
            }
            return (
              <div className="small" style={{ marginTop: 4 }}>
                {customers.map((c) => (
                  <div key={c.id} className="row between">
                    <span>
                      {state.firms[state.facilities[c.destinationFacilityId]?.ownerFirmId ?? '']?.name ?? '?'}
                      {' buys '}{getProduct(c.productId).name}
                    </span>
                    <span className="mono muted">target {c.targetQuantity}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* Warehouse: export to the trade cities */}
      {fac.type === 'warehouse' && isPlayer && (
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>🚢 Export — Port Rosa & Ironvale</div>
          <p className="muted small" style={{ margin: '0 0 6px' }}>
            Each city's prices drift daily around its own bias (Ironvale pays up
            for industry, discounts food) and follow world events; freight takes
            ~8% (more during fuel spikes, more to inland Ironvale). Ship to
            whichever port pays — the button routes each product to today's best
            net price.
          </p>
          {ALL_PRODUCT_IDS.map((pid) => {
            const qty = getQuantity(fac.inputInventory, pid) + getQuantity(fac.outputInventory, pid);
            if (qty <= 0) return null;
            const base = getProduct(pid).basePrice;
            const best = pickBestCity(state, pid);
            return (
              <div className="row between small" key={pid} style={{ marginBottom: 4 }}>
                <span>{getProduct(pid).name} × {qty}</span>
                <span className="mono">
                  {TRADE_CITY_IDS.map((cid) => {
                    const price = cityPrice(state, cid, pid);
                    const mult = price / base;
                    const isBest = cid === best.cityId;
                    return (
                      <span
                        key={cid}
                        title={`${getTradeCity(cid).name}: ${formatMoney(price)} (${mult.toFixed(2)}× base)`}
                        style={{
                          marginLeft: 6,
                          color: mult >= 1.3 ? 'var(--green)' : mult <= 0.75 ? 'var(--red)' : undefined,
                          fontWeight: isBest ? 700 : 400,
                        }}
                      >
                        {getTradeCity(cid).emoji}{formatMoney(price)}
                      </span>
                    );
                  })}
                </span>
                <button
                  title={`Ships to ${getTradeCity(best.cityId).name} (best net price today)`}
                  onClick={() =>
                    dispatch({ type: 'EXPORT_GOODS', firmId: fac.ownerFirmId, facilityId: fac.id, productId: pid, quantity: qty })
                  }
                >
                  Export all
                </button>
              </div>
            );
          })}
          {ALL_PRODUCT_IDS.every(
            (pid) => getQuantity(fac.inputInventory, pid) + getQuantity(fac.outputInventory, pid) <= 0,
          ) && <div className="muted small">Nothing staged — wire a supply contract into this warehouse.</div>}

          <div className="section-title">Standing orders (auto-export daily)</div>
          {ALL_PRODUCT_IDS.filter(
            (pid) =>
              fac.exportOrders[pid] !== undefined ||
              getQuantity(fac.inputInventory, pid) + getQuantity(fac.outputInventory, pid) > 0,
          ).map((pid) => {
            const order = fac.exportOrders[pid];
            return (
              <div className="row between small" key={`order-${pid}`} style={{ marginBottom: 4 }}>
                <span>{getProduct(pid).name}</span>
                <span className="row" style={{ gap: 4 }}>
                  <select
                    value={order ? String(order.minMult) : ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      dispatch({
                        type: 'SET_EXPORT_ORDER',
                        facilityId: fac.id,
                        productId: pid,
                        minMult: v === '' ? null : parseFloat(v),
                        keep: order?.keep ?? 10,
                      });
                    }}
                  >
                    <option value="">off</option>
                    <option value="1.15">sell ≥1.15×</option>
                    <option value="1.3">sell ≥1.3×</option>
                    <option value="1.5">sell ≥1.5×</option>
                  </select>
                  {order && (
                    <label title="Units to keep in reserve">
                      keep
                      <input
                        type="number"
                        min={0}
                        defaultValue={order.keep}
                        style={{ width: 46, marginLeft: 3 }}
                        onBlur={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (Number.isFinite(v)) {
                            dispatch({
                              type: 'SET_EXPORT_ORDER',
                              facilityId: fac.id,
                              productId: pid,
                              minMult: order.minMult,
                              keep: v,
                            });
                          }
                        }}
                      />
                    </label>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Retail assortment + per-product pricing */}
      {fac.type === 'retail' && (
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>
            Retail — carries {fac.retailProductIds.length}/3 products
          </div>
          {isPlayer ? (
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
              {def.allowedProductsForSale.map((pid) => (
                <label key={pid} className="row small" style={{ cursor: 'pointer', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={fac.retailProductIds.includes(pid)}
                    disabled={!fac.retailProductIds.includes(pid) && fac.retailProductIds.length >= 3}
                    onChange={() =>
                      dispatch({ type: 'TOGGLE_RETAIL_PRODUCT', facilityId: fac.id, productId: pid })
                    }
                  />
                  {getProduct(pid).name}
                </label>
              ))}
            </div>
          ) : (
            <div className="small">
              Sells: {fac.retailProductIds.map((pid) => getProduct(pid).name).join(', ') || 'none'}
            </div>
          )}
          {isPlayer && fac.retailProductIds.length > 1 && (
            <p className="muted small" style={{ margin: '2px 0 6px' }}>
              Basket effect: one staffed storefront, several revenue streams — shoppers
              buy every carried product they need per visit. Wire a supply contract for each.
            </p>
          )}
          {firm &&
            fac.retailProductIds.map((pid) => (
              <div key={pid} style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 6 }}>
                <strong className="small">{getProduct(pid).name}</strong>
                <PriceControl
                  firmId={fac.ownerFirmId}
                  productId={pid}
                  price={firm.pricesByProduct[pid] ?? getProduct(pid).basePrice}
                  editable={isPlayer}
                />
                {isPlayer && (() => {
                  const ins = pricingInsight(state, firm.id, pid);
                  const overWtp = ins.yourPrice > ins.wtpHigh;
                  return (
                    <div className="small muted" style={{ margin: '4px 0', lineHeight: 1.5 }}>
                      Market avg <span className="mono">{ins.marketAvgPrice ? formatMoney(ins.marketAvgPrice) : '—'}</span>
                      {' · '}customers pay up to{' '}
                      <span className="mono" style={{ color: overWtp ? 'var(--red)' : 'var(--green)' }}>
                        {formatMoney(ins.wtpLow)}–{formatMoney(ins.wtpHigh)}
                      </span>
                      {' · '}{ins.competitors} rival store{ins.competitors === 1 ? '' : 's'}
                      {' · '}share <span className="mono">{(ins.yourShare * 100).toFixed(0)}%</span>
                      {overWtp && <strong style={{ color: 'var(--red)' }}> — priced above what anyone will pay!</strong>}
                    </div>
                  );
                })()}
                {isPlayer && (
                  <label className="row small" style={{ marginTop: 2, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={firm.autoPriceByProduct[pid] ?? false}
                      onChange={(e) =>
                        dispatch({ type: 'SET_AUTO_PRICE', firmId: firm.id, productId: pid, enabled: e.target.checked })
                      }
                    />
                    Auto-price
                  </label>
                )}
                <MarketingControls firm={firm} productId={pid} editable={isPlayer} />
              </div>
            ))}
        </div>
      )}

      {/* Upgrade */}
      {isPlayer && def.buildCost > 0 && (
        <div className="card">
          <div className="row between">
            <span className="section-title" style={{ margin: 0 }}>
              Level {fac.level}{fac.level >= 3 ? ' (max)' : ''}
            </span>
            {fac.level < 3 && (
              <button
                disabled={(firm?.cash ?? 0) < upgradeCost(state, fac.id)}
                title="+40% storage, +15% production speed, +1 worker slot"
                onClick={() => dispatch({ type: 'UPGRADE_FACILITY', firmId: fac.ownerFirmId, facilityId: fac.id })}
              >
                ⬆ Upgrade to L{fac.level + 1} — {formatMoney(upgradeCost(state, fac.id))}
              </button>
            )}
          </div>
          {sellValue !== null && (
            <div className="row" style={{ marginTop: 6 }}>
              <button
                style={{ color: 'var(--red)' }}
                title="Refunds half the build cost. Workers return to the labor pool; contracts, shipments, and stored goods are written off."
                onClick={() => {
                  if (
                    confirm(
                      `Sell ${fac.name} for ${formatMoney(sellValue)}? Its workers are released and any stored goods, contracts, and shipments are lost.`,
                    )
                  ) {
                    dispatch({ type: 'SELL_FACILITY', firmId: fac.ownerFirmId, facilityId: fac.id });
                  }
                }}
              >
                🏚 Sell — {formatMoney(sellValue)}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Workers */}
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          Workers {employees.length}/{fac.workerCapacity} · present {fac.presentWorkers}
        </div>
        {isPlayer && (
          <div className="row" style={{ marginBottom: 6 }}>
            <button
              disabled={employees.length >= fac.workerCapacity}
              onClick={() => dispatch({ type: 'HIRE_WORKER', facilityId: fac.id, citizenId: null })}
            >
              + Hire unemployed
            </button>
          </div>
        )}
        {employees.map((c) => (
          <div className="row between small" key={c.id}>
            <span>{c.name} ({c.role})</span>
            {isPlayer && (
              <button onClick={() => dispatch({ type: 'FIRE_WORKER', facilityId: fac.id, citizenId: c.id })}>
                fire
              </button>
            )}
          </div>
        ))}
        {employees.length === 0 && <div className="small muted">No workers.</div>}
      </div>

      {/* Supply contracts feeding this facility */}
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>Inbound Supply Contracts</div>
        {contractsByDestination(state, fac.id).map((c) => (
          <div className="row between small" key={c.id} style={{ opacity: c.active ? 1 : 0.55 }}>
            <span>
              {state.facilities[c.sourceFacilityId]?.name} → {getProduct(c.productId).name}
              {!c.active && ' (paused)'}
            </span>
            {isPlayer ? (
              <span className="row" style={{ gap: 4 }}>
                <label title="Reorder when stock falls below this">
                  ↻<input
                    type="number"
                    defaultValue={c.reorderPoint}
                    min={0}
                    style={{ width: 46 }}
                    onBlur={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (Number.isFinite(v)) {
                        dispatch({ type: 'UPDATE_SUPPLY_CONTRACT', contractId: c.id, reorderPoint: v });
                      }
                    }}
                  />
                </label>
                <label title="Units per shipment">
                  📦<input
                    type="number"
                    defaultValue={c.targetQuantity}
                    min={1}
                    style={{ width: 46 }}
                    onBlur={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (Number.isFinite(v)) {
                        dispatch({ type: 'UPDATE_SUPPLY_CONTRACT', contractId: c.id, targetQuantity: v });
                      }
                    }}
                  />
                </label>
                <button
                  title={c.active ? 'Pause shipments' : 'Resume shipments'}
                  onClick={() => dispatch({ type: 'UPDATE_SUPPLY_CONTRACT', contractId: c.id, active: !c.active })}
                >
                  {c.active ? '⏸' : '▶'}
                </button>
                <button title="Delete contract" onClick={() => dispatch({ type: 'CANCEL_SUPPLY_CONTRACT', contractId: c.id })}>×</button>
              </span>
            ) : (
              <span className="muted">reorder {c.reorderPoint}</span>
            )}
          </div>
        ))}
        {isPlayer && (
          <div className="small" style={{ marginTop: 6 }}>
            <div className="row">
              <select value={src} onChange={(e) => setSrc(e.target.value)}>
                <option value="">source facility…</option>
                {Object.values(state.facilities)
                  .filter((f) => f.id !== fac.id && f.type !== 'home')
                  .sort((a, b) =>
                    Number(b.ownerFirmId === fac.ownerFirmId) - Number(a.ownerFirmId === fac.ownerFirmId))
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.ownerFirmId === fac.ownerFirmId || state.firms[f.ownerFirmId]?.ownerType === 'external'
                        ? f.name
                        : `${f.name} — ${state.firms[f.ownerFirmId]?.name ?? '?'} (wholesale)`}
                    </option>
                  ))}
              </select>
              <select value={ctrProduct} onChange={(e) => setCtrProduct(e.target.value)}>
                <option value="">product…</option>
                {ALL_PRODUCT_IDS.map((pid) => (
                  <option key={pid} value={pid}>{getProduct(pid).name}</option>
                ))}
              </select>
            </div>
            <div className="row" style={{ marginTop: 4 }}>
              <label>reorder <input type="number" style={{ width: 50 }} value={reorder} onChange={(e) => setReorder(+e.target.value)} /></label>
              <label>target <input type="number" style={{ width: 50 }} value={target} onChange={(e) => setTarget(+e.target.value)} /></label>
              <label>max <input type="number" style={{ width: 50 }} value={maxInv} onChange={(e) => setMaxInv(+e.target.value)} /></label>
            </div>
            <button
              style={{ marginTop: 4 }}
              disabled={!src || !ctrProduct}
              onClick={() => {
                dispatch({
                  type: 'CREATE_SUPPLY_CONTRACT',
                  ownerFirmId: fac.ownerFirmId,
                  sourceFacilityId: src,
                  destinationFacilityId: fac.id,
                  productId: ctrProduct,
                  targetQuantity: target,
                  reorderPoint: reorder,
                  maxInventory: maxInv,
                });
                setSrc('');
                setCtrProduct('');
              }}
            >
              Create contract
            </button>
            <p className="muted" style={{ marginTop: 4 }}>
              Wholesale sources (other firms) charge ~70% of the market's
              average price per unit, paid on each shipment — cheaper than
              importing, and they never sell you stock their own chains need.
            </p>
          </div>
        )}
      </div>

      {/* Buy from importer */}
      {isPlayer && (fac.type === 'factory' || fac.type === 'warehouse' || fac.type === 'retail') && (
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>Buy from Importer (premium)</div>
          <div className="row">
            <select value={importProduct} onChange={(e) => setImportProduct(e.target.value)}>
              {['grain', 'minerals', 'bread', 'tools'].map((pid) => (
                <option key={pid} value={pid}>{getProduct(pid).name}</option>
              ))}
            </select>
            <input type="number" style={{ width: 60 }} value={importQty} onChange={(e) => setImportQty(+e.target.value)} />
            <button
              onClick={() =>
                dispatch({
                  type: 'BUY_FROM_IMPORTER',
                  firmId: fac.ownerFirmId,
                  destinationFacilityId: fac.id,
                  productId: importProduct,
                  quantity: importQty,
                })
              }
            >
              Buy
            </button>
          </div>
          <div className="small muted">Have: {getQuantity(fac.inputInventory, importProduct)} in input store.</div>
        </div>
      )}
    </div>
  );
}

function MarketingControls({
  firm,
  productId,
  editable,
}: {
  firm: import('../sim/entities/Firm').Firm;
  productId: string;
  editable: boolean;
}): React.ReactElement {
  const dispatch = useGameStore((s) => s.dispatch);
  const brand = firm.brandByProduct[productId] ?? 0;
  const quality = firm.qualityByProduct[productId] ?? getProduct(productId).defaultQuality;
  const adBudget = firm.adBudgetByProduct[productId] ?? 0;
  const [ad, setAd] = useState((adBudget / CENTS).toFixed(0));
  React.useEffect(() => setAd((adBudget / CENTS).toFixed(0)), [adBudget]);

  return (
    <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
      <div className="kv small"><span className="k">Brand</span><span className="mono">{brand.toFixed(0)}/100</span></div>
      <div className="bar" style={{ margin: '2px 0 5px' }}><span style={{ width: `${brand}%`, background: 'var(--purple)' }} /></div>
      <div className="kv small"><span className="k">Quality</span><span className="mono">{quality.toFixed(0)}/100</span></div>
      <div className="bar" style={{ margin: '2px 0 6px' }}><span style={{ width: `${quality}%`, background: 'var(--green)' }} /></div>
      {editable && (
        <>
          <div className="row between small">
            <span className="k">Ad budget / day</span>
            <span className="row">$<input style={{ width: 56 }} value={ad} onChange={(e) => setAd(e.target.value)}
              onBlur={() => {
                const cents = Math.max(0, Math.round(parseFloat(ad || '0') * CENTS));
                dispatch({ type: 'SET_AD_BUDGET', firmId: firm.id, productId, dailyBudget: cents });
              }} /></span>
          </div>
          <div className="row" style={{ marginTop: 5 }}>
            {[1000, 5000].map((amt) => (
              <button key={amt} onClick={() => dispatch({ type: 'INVEST_RND', firmId: firm.id, productId, amount: amt * CENTS })}>
                R&D +${amt.toLocaleString()}
              </button>
            ))}
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            Advertising builds brand (decays ~3%/day). R&D raises quality. Both lift demand &amp; the
            price customers will pay.
          </div>
        </>
      )}
    </div>
  );
}

function RecipeInfo({ recipeId }: { recipeId: string }): React.ReactElement {
  const r = getRecipe(recipeId);
  return (
    <div className="small muted" style={{ marginTop: 4 }}>
      In: {r.inputs.map((i) => `${i.quantity} ${getProduct(i.productId).name}`).join(', ') || 'none'} →
      Out: {r.outputs.map((o) => `${o.quantity} ${getProduct(o.productId).name}`).join(', ')} ·
      {r.laborRequired} workers · {r.ticksRequired} ticks · var {formatMoney(r.variableCost)}
    </div>
  );
}

function PriceControl({
  firmId,
  productId,
  price,
  editable,
}: {
  firmId: string;
  productId: string;
  price: number;
  editable: boolean;
}): React.ReactElement {
  const dispatch = useGameStore((s) => s.dispatch);
  const base = getProduct(productId).basePrice;
  const [val, setVal] = useState((price / CENTS).toFixed(2));
  React.useEffect(() => setVal((price / CENTS).toFixed(2)), [price]);

  return (
    <div className="row between" style={{ marginTop: 6 }}>
      <span className="small muted">Price (base {formatMoney(base)})</span>
      {editable ? (
        <span className="row">
          $<input
            style={{ width: 60 }}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => {
              const cents = Math.round(parseFloat(val) * CENTS);
              if (cents > 0) dispatch({ type: 'SET_PRICE', firmId, productId, price: cents });
            }}
          />
        </span>
      ) : (
        <span className="mono">{formatMoney(price)}</span>
      )}
    </div>
  );
}
