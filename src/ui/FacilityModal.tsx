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
import { CENTS } from '../sim/data/constants';

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

      {/* Retail product + price */}
      {fac.type === 'retail' && (
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>Retail</div>
          {isPlayer ? (
            <div className="row between">
              <span>Sells:</span>
              <select
                value={fac.retailProductId ?? ''}
                onChange={(e) =>
                  dispatch({
                    type: 'SET_RETAIL_PRODUCT',
                    facilityId: fac.id,
                    productId: e.target.value || null,
                  })
                }
              >
                <option value="">— none —</option>
                {def.allowedProductsForSale.map((pid) => (
                  <option key={pid} value={pid}>{getProduct(pid).name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="small">Sells: {fac.retailProductId ? getProduct(fac.retailProductId).name : 'none'}</div>
          )}
          {fac.retailProductId && firm && (
            <PriceControl
              firmId={fac.ownerFirmId}
              productId={fac.retailProductId}
              price={firm.pricesByProduct[fac.retailProductId] ?? getProduct(fac.retailProductId).basePrice}
              editable={isPlayer}
            />
          )}
        </div>
      )}

      {/* Workers */}
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          Workers {employees.length}/{def.workerCapacity} · present {fac.presentWorkers}
        </div>
        {isPlayer && (
          <div className="row" style={{ marginBottom: 6 }}>
            <button
              disabled={employees.length >= def.workerCapacity}
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
          <div className="row between small" key={c.id}>
            <span>
              {state.facilities[c.sourceFacilityId]?.name} → {getProduct(c.productId).name}{' '}
              (reorder {c.reorderPoint})
            </span>
            {isPlayer && (
              <button onClick={() => dispatch({ type: 'CANCEL_SUPPLY_CONTRACT', contractId: c.id })}>×</button>
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
                  .map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
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
