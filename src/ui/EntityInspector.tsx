/**
 * EntityInspector — detailed, inspectable view of any selected entity, with
 * formula tooltips on the important numbers. Facilities also get action
 * controls via FacilityActions.
 */

import React from 'react';
import { useGameStore } from '../store/useGameStore';
import type { GameState } from '../sim/core/GameState';
import type { Facility } from '../sim/entities/Facility';
import type { Citizen } from '../sim/entities/Citizen';
import type { Firm } from '../sim/entities/Firm';
import type { Vehicle } from '../sim/entities/Vehicle';
import { FacilityActions } from './FacilityModal';
import { FormulaTooltip } from './FormulaTooltip';
import { formatMoney } from '../utils/formatMoney';
import { getProduct } from '../sim/data/products';
import { citizenActionLabel } from '../sim/selectors/citizenSelectors';
import { firmPnLToday, firmPnLLifetime, firmFacilities, firmWarnings } from '../sim/selectors/companySelectors';
import { facilityProfitContribution } from '../sim/selectors/facilitySelectors';
import { clamp } from '../utils/clamp';

export function EntityInspector({ id }: { id: string }): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const state = sim.getState();
  if (state.facilities[id]) return <FacilityView fac={state.facilities[id]!} state={state} />;
  if (state.citizens[id]) return <CitizenView c={state.citizens[id]!} state={state} />;
  if (state.firms[id]) return <FirmView firm={state.firms[id]!} state={state} />;
  if (state.vehicles[id]) return <VehicleView v={state.vehicles[id]!} state={state} />;
  return <div className="muted small">Selected entity no longer exists.</div>;
}

function StatusTag({ status }: { status: Facility['status'] }): React.ReactElement {
  const cls =
    status === 'active' ? 'green' : status === 'closed' ? 'red' : status === 'idle' ? 'grey' : 'amber';
  return <span className={`tag ${cls}`}>{status}</span>;
}

function Inv({ title, inv }: { title: string; inv: Record<string, { quantity: number }> }): React.ReactElement {
  const entries = Object.values(inv).filter((s) => s.quantity > 0);
  return (
    <div className="small">
      <span className="muted">{title}: </span>
      {entries.length === 0 ? <span className="muted">empty</span> : entries.map((s: any) => (
        <span key={s.productId} style={{ marginRight: 8 }}>{getProduct(s.productId).name} ×{Math.floor(s.quantity)}</span>
      ))}
    </div>
  );
}

function FacilityView({ fac, state }: { fac: Facility; state: GameState }): React.ReactElement {
  const firm = state.firms[fac.ownerFirmId];
  const contribution = facilityProfitContribution(state, fac.id);
  return (
    <div>
      <h3 style={{ margin: '0 0 2px' }}>{fac.name}</h3>
      <div className="small muted">{fac.type} · owned by {firm?.name ?? 'unknown'}</div>
      <div className="row" style={{ margin: '6px 0' }}>
        <StatusTag status={fac.status} />
        {fac.bottleneckReason && <span className="small" style={{ color: 'var(--amber)' }}>{fac.bottleneckReason}</span>}
      </div>

      <Inv title="Input" inv={fac.inputInventory} />
      <Inv title="Output" inv={fac.outputInventory} />

      <div className="kv small" style={{ marginTop: 6 }}>
        <span className="k">Production progress</span>
        <span className="mono">{fac.productionProgress.toFixed(2)}</span>
      </div>
      <div className="kv small">
        <span className="k">Sold today</span><span className="mono">{fac.dailyStats.unitsSold}</span>
      </div>
      <div className="kv small">
        <span className="k">Produced today</span><span className="mono">{fac.dailyStats.unitsProduced}</span>
      </div>
      <div className="kv small">
        <span className="k">Lost sales today</span><span className="mono">{fac.dailyStats.lostSales}</span>
      </div>
      <div className="kv small">
        <span className="k">
          <FormulaTooltip
            title="Profit contribution (today)"
            explanation="revenue today − variable cost − daily maintenance − wages of assigned workers"
          >
            Profit contribution
          </FormulaTooltip>
        </span>
        <span className="mono" style={{ color: contribution >= 0 ? 'var(--green)' : 'var(--red)' }}>
          {formatMoney(contribution)}
        </span>
      </div>

      <div style={{ marginTop: 8 }}>
        <FacilityActions fac={fac} />
      </div>
    </div>
  );
}

function CitizenView({ c, state }: { c: Citizen; state: GameState }): React.ReactElement {
  const employer = c.employerFirmId ? state.firms[c.employerFirmId] : null;
  return (
    <div>
      <h3 style={{ margin: '0 0 2px' }}>{c.name}</h3>
      <div className="small muted">{citizenActionLabel(c)}</div>
      <div className="kv small" style={{ marginTop: 6 }}>
        <span className="k">Cash</span><span className="mono">{formatMoney(c.cash)}</span>
      </div>
      <div className="kv small"><span className="k">Employer</span><span>{employer?.name ?? 'unemployed'}</span></div>
      <div className="kv small"><span className="k">Wage / payday</span><span className="mono">{formatMoney(c.wage)}</span></div>
      <div className="kv small">
        <span className="k">
          <FormulaTooltip title="Satisfaction" explanation="Rises when employed and needs are met; falls with unmet needs and missed pay.">
            Satisfaction
          </FormulaTooltip>
        </span>
        <span className="mono">{c.satisfaction.toFixed(0)}/100</span>
      </div>
      <div className="bar" style={{ margin: '4px 0' }}>
        <span style={{ width: `${clamp(c.satisfaction, 0, 100)}%` }} />
      </div>

      <div className="section-title">Needs</div>
      {c.needs.map((n) => (
        <div className="kv small" key={n.productId}>
          <span className="k">{getProduct(n.productId).name}</span>
          <FormulaTooltip
            title="Need urgency"
            explanation={`Grows ${n.urgencyGrowthPerDay.toFixed(2)}/day. Shops when above ${state.config.needUrgencyThreshold}. Buys ${n.preferredQuantity} at a time.`}
          >
            <span className="mono">{n.urgency.toFixed(2)}</span>
          </FormulaTooltip>
        </div>
      ))}

      <div className="section-title">Recent purchases (preferred stores)</div>
      {Object.entries(c.lastPurchasedFromByProduct).map(([pid, fid]) => (
        <div className="small" key={pid}>
          {getProduct(pid).name} ← {state.facilities[fid]?.name ?? fid}
        </div>
      ))}
      {Object.keys(c.lastPurchasedFromByProduct).length === 0 && <div className="small muted">none yet</div>}
    </div>
  );
}

function FirmView({ firm, state }: { firm: Firm; state: GameState }): React.ReactElement {
  const today = firmPnLToday(state, firm.id);
  const life = firmPnLLifetime(state, firm.id);
  const warnings = firmWarnings(state, firm.id);
  return (
    <div>
      <h3 style={{ margin: '0 0 2px' }}>{firm.name}</h3>
      <div className="small muted">{firm.ownerType} firm · <span className={`tag ${firm.bankruptcyStatus === 'healthy' ? 'green' : 'red'}`}>{firm.bankruptcyStatus}</span></div>
      <div className="kv small" style={{ marginTop: 6 }}>
        <span className="k">Cash</span>
        <span className="mono" style={{ color: firm.cash < 0 ? 'var(--red)' : 'var(--green)' }}>{formatMoney(firm.cash)}</span>
      </div>
      <div className="kv small">
        <span className="k">Debt</span>
        <span className="mono" style={{ color: firm.debt > 0 ? 'var(--amber)' : undefined }}>{formatMoney(firm.debt)}</span>
      </div>
      {firm.ownerType === 'player' && <FinanceControls firmId={firm.id} />}

      <div className="section-title">P&L Today</div>
      <PnL p={today} />
      <div className="section-title">P&L Lifetime</div>
      <PnL p={life} />

      <div className="section-title">Prices</div>
      {Object.entries(firm.pricesByProduct).map(([pid, price]) => (
        <div className="kv small" key={pid}>
          <span className="k">{getProduct(pid).name}</span>
          <span className="mono">{formatMoney(price)} · share {((firm.marketShareByProduct[pid] ?? 0) * 100).toFixed(0)}%</span>
        </div>
      ))}

      <div className="section-title">Facilities ({firmFacilities(state, firm.id).length})</div>
      {firmFacilities(state, firm.id).map((f) => (
        <div className="small" key={f.id}>{f.name} — {f.status}</div>
      ))}

      {warnings.length > 0 && (
        <>
          <div className="section-title" style={{ color: 'var(--amber)' }}>Warnings</div>
          {warnings.map((w, i) => <div className="small" key={i} style={{ color: 'var(--amber)' }}>⚠ {w}</div>)}
        </>
      )}
    </div>
  );
}

function FinanceControls({ firmId }: { firmId: string }): React.ReactElement {
  const dispatch = useGameStore((s) => s.dispatch);
  return (
    <div className="row" style={{ gap: 6, marginTop: 4 }}>
      {[5000, 20000].map((amt) => (
        <button key={amt} onClick={() => dispatch({ type: 'TAKE_LOAN', firmId, amount: amt * 100 })}>
          Borrow ${(amt / 1000).toFixed(0)}k
        </button>
      ))}
      <button onClick={() => dispatch({ type: 'REPAY_LOAN', firmId, amount: 1_000_000_00 })} title="Repay as much as cash allows">
        Repay
      </button>
    </div>
  );
}

function PnL({ p }: { p: ReturnType<typeof firmPnLToday> }): React.ReactElement {
  return (
    <>
      <div className="kv small"><span className="k">Revenue</span><span className="mono">{formatMoney(p.revenue)}</span></div>
      <div className="kv small"><span className="k">COGS</span><span className="mono">{formatMoney(p.costOfGoodsSold)}</span></div>
      <div className="kv small"><span className="k">Wages</span><span className="mono">{formatMoney(p.wages)}</span></div>
      <div className="kv small"><span className="k">Maintenance</span><span className="mono">{formatMoney(p.maintenance)}</span></div>
      <div className="kv small"><span className="k">Logistics</span><span className="mono">{formatMoney(p.logisticsCost)}</span></div>
      <div className="kv small"><span className="k">Variable cost</span><span className="mono">{formatMoney(p.variableProductionCost)}</span></div>
      <div className="kv small"><span className="k">Marketing</span><span className="mono">{formatMoney(p.marketing)}</span></div>
      <div className="kv small"><span className="k">R&amp;D</span><span className="mono">{formatMoney(p.rnd)}</span></div>
      <div className="kv small"><span className="k">Interest</span><span className="mono">{formatMoney(p.interest)}</span></div>
      <div className="kv small">
        <span className="k">
          <FormulaTooltip title="Gross profit" explanation="revenue − cost of goods sold">Gross profit</FormulaTooltip>
        </span>
        <span className="mono">{formatMoney(p.grossProfit)}</span>
      </div>
      <div className="kv small">
        <span className="k">
          <FormulaTooltip title="Operating profit" explanation="revenue − COGS − wages − maintenance − logistics − variable cost − marketing − R&D">
            Operating profit
          </FormulaTooltip>
        </span>
        <span className="mono" style={{ color: p.operatingProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
          {formatMoney(p.operatingProfit)}
        </span>
      </div>
      <div className="kv small">
        <span className="k">
          <FormulaTooltip title="Net profit" explanation="operating profit − loan interest">Net profit</FormulaTooltip>
        </span>
        <span className="mono" style={{ color: p.netProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
          {formatMoney(p.netProfit)}
        </span>
      </div>
    </>
  );
}

function VehicleView({ v, state }: { v: Vehicle; state: GameState }): React.ReactElement {
  return (
    <div>
      <h3 style={{ margin: '0 0 2px' }}>Shipment</h3>
      <div className="small muted">{state.firms[v.ownerFirmId]?.name}</div>
      <div className="kv small" style={{ marginTop: 6 }}>
        <span className="k">Cargo</span>
        <span className="mono">{Math.floor(v.cargo.quantity)} {getProduct(v.cargo.productId).name}</span>
      </div>
      <div className="kv small"><span className="k">From</span><span>{state.facilities[v.originFacilityId]?.name}</span></div>
      <div className="kv small"><span className="k">To</span><span>{state.facilities[v.destinationFacilityId]?.name}</span></div>
      <div className="kv small"><span className="k">Arrives in</span><span className="mono">{v.ticksUntilArrival} ticks</span></div>
      <div className="kv small"><span className="k">Transport cost</span><span className="mono">{formatMoney(v.transportCost)}</span></div>
    </div>
  );
}
