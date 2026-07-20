import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { PRODUCT_IDS_BY_PRESET, getProduct } from '../sim/data/products';
import {
  inventoryByFacility,
  activeShipments,
  allContracts,
  bottlenecks,
} from '../sim/selectors/supplyChainSelectors';
import { formatMoney } from '../utils/formatMoney';

export function SupplyChainDashboard(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const select = useGameStore((s) => s.select);
  const state = sim.getState();
  const shipments = activeShipments(state);
  const contracts = allContracts(state);
  const necks = bottlenecks(state);

  return (
    <div>
      <h3>Inventory by Product & Facility</h3>
      {PRODUCT_IDS_BY_PRESET[state.config.sizePreset].map((pid) => {
        const rows = inventoryByFacility(state, pid);
        if (rows.length === 0) return null;
        return (
          <div key={pid} style={{ marginBottom: 8 }}>
            <strong>{getProduct(pid).name}</strong>
            <table>
              <thead><tr><th>Facility</th><th>Input</th><th>Output</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.facilityId} style={{ cursor: 'pointer' }} onClick={() => select(r.facilityId)}>
                    <td>{r.facilityName}</td>
                    <td className="mono">{Math.floor(r.input)}</td>
                    <td className="mono">{Math.floor(r.output)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <h3>Active Shipments ({shipments.length})</h3>
      <table>
        <thead><tr><th>Cargo</th><th>From</th><th>To</th><th>ETA (ticks)</th><th>Cost</th></tr></thead>
        <tbody>
          {shipments.map((v) => (
            <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => select(v.id)}>
              <td>{Math.floor(v.cargo.quantity)} {getProduct(v.cargo.productId).name}</td>
              <td>{state.facilities[v.originFacilityId]?.name}</td>
              <td>{state.facilities[v.destinationFacilityId]?.name}</td>
              <td className="mono">{v.ticksUntilArrival}</td>
              <td className="mono">{formatMoney(v.transportCost)}</td>
            </tr>
          ))}
          {shipments.length === 0 && <tr><td colSpan={5} className="muted">No shipments in transit.</td></tr>}
        </tbody>
      </table>

      <h3>Supply Contracts ({contracts.length})</h3>
      <table>
        <thead><tr><th>Owner</th><th>Product</th><th>Route</th><th>Reorder</th><th>Target</th><th>Max</th></tr></thead>
        <tbody>
          {contracts.map((c) => (
            <tr key={c.id}>
              <td>{state.firms[c.ownerFirmId]?.name}</td>
              <td>{getProduct(c.productId).name}</td>
              <td>{state.facilities[c.sourceFacilityId]?.name} → {state.facilities[c.destinationFacilityId]?.name}</td>
              <td className="mono">{c.reorderPoint}</td>
              <td className="mono">{c.targetQuantity}</td>
              <td className="mono">{c.maxInventory}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ color: necks.length ? 'var(--amber)' : undefined }}>Bottlenecks ({necks.length})</h3>
      {necks.map((b) => (
        <div className="small" key={b.facilityId} style={{ color: 'var(--amber)', cursor: 'pointer' }} onClick={() => select(b.facilityId)}>
          ⚠ {b.facilityName}: {b.reason}
        </div>
      ))}
      {necks.length === 0 && <div className="muted small">None.</div>}
    </div>
  );
}
