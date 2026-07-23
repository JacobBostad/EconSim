/**
 * EntityInspector — detailed, inspectable view of any selected entity, with
 * formula tooltips on the important numbers. Facilities also get action
 * controls via FacilityActions.
 */

import React from 'react';
import { useGameStore } from '../store/useGameStore';
import type { GameState } from '../sim/core/GameState';
import type { Facility } from '../sim/entities/Facility';
import { crowdCount } from '../sim/entities/Facility';
import type { Citizen } from '../sim/entities/Citizen';
import type { Firm } from '../sim/entities/Firm';
import type { Vehicle } from '../sim/entities/Vehicle';
import { FacilityActions } from './FacilityModal';
import { FormulaTooltip } from './FormulaTooltip';
import { formatMoney } from '../utils/formatMoney';
import { getProduct } from '../sim/data/products';
import { citizenActionLabel, populationStats } from '../sim/selectors/citizenSelectors';
import { firmPnLToday, firmPnLLifetime, firmFacilities, firmWarnings, rivalTopWage } from '../sim/selectors/companySelectors';
import { getPersonality } from '../sim/data/personalities';
import { morningBriefing } from '../sim/selectors/advisorSelectors';
import { managerCandidates, managerDuties } from '../sim/systems/ManagerSystem';
import { computeTime } from '../sim/core/Tick';
import { APARTMENT_RENT_PER_DAY } from '../sim/data/constants';
import { facilityProfitContribution } from '../sim/selectors/facilitySelectors';
import { clamp } from '../utils/clamp';
import { townOf } from '../sim/core/Town';

export function EntityInspector({ id }: { id: string }): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const state = sim.getState();
  // The inspector renders the home town (one-town region → identical reference);
  // it gains a town selector at the endgame move.
  const town = townOf(state);
  if (town.facilities[id]) return <FacilityView fac={town.facilities[id]!} state={state} />;
  if (town.citizens[id]) return <CitizenView c={town.citizens[id]!} state={state} />;
  if (town.firms[id]) return <FirmView firm={town.firms[id]!} state={state} />;
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
  const town = townOf(state);
  const firm = town.firms[fac.ownerFirmId];
  const contribution = facilityProfitContribution(state, fac.id);
  return (
    <div>
      <h3 style={{ margin: '0 0 2px' }}>{fac.name}</h3>
      <div className="small muted">{fac.type} · owned by {firm?.name ?? 'unknown'}</div>
      <div className="row" style={{ margin: '6px 0' }}>
        <StatusTag status={fac.status} />
        {fac.bottleneckReason && <span className="small" style={{ color: 'var(--amber)' }}>{fac.bottleneckReason}</span>}
      </div>

      {fac.type === 'home' && (
        <div className="kv small">
          <span className="k">Residents</span>
          <span className="mono">{fac.residentIds.length}/2</span>
        </div>
      )}
      {fac.defId === 'apartment' && (
        <div className="kv small">
          <span className="k">Rent income</span>
          <span className="mono">{formatMoney(fac.residentIds.length * APARTMENT_RENT_PER_DAY)}/day</span>
        </div>
      )}
      {/* Crowd staffing is City-preset only; a Village facility has none, so
          this line never appears and the panel stays bit-identical there. */}
      {crowdCount(fac) > 0 && (
        <div className="kv small">
          <span className="k">Staff</span>
          <span className="mono">{fac.employees.length} named + {crowdCount(fac)} crowd</span>
        </div>
      )}
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
      {(() => {
        // Mirror of facilityPnL for one building: the last closed day.
        const y = fac.yesterdayStats;
        const yRevenue = y.revenue + y.transferOutValue;
        const yCost =
          (firm ? fac.employees.length * firm.wagePolicy.baseWage : 0) +
          fac.operatingCostPerDay + y.variableCost + y.transferInValue;
        const yNet = yRevenue - yCost;
        return (
          <div className="kv small">
            <span className="k">
              <FormulaTooltip
                title="Yesterday's P&L"
                explanation="Last closed day: cash earnings + shipments out (valued at market price) − wages − upkeep − variable cost − inputs received. Firm-wide spend (ads, R&D, interest, freight) not attributed."
              >
                Yesterday net
              </FormulaTooltip>
            </span>
            <span className="mono" style={{ color: yNet >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {formatMoney(yNet)} ({formatMoney(yRevenue)} in / {formatMoney(yCost)} out)
              {' · 7d Ø '}
              <span style={{ color: fac.pnlEma.net >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {formatMoney(Math.round(fac.pnlEma.net))}
              </span>
            </span>
          </div>
        );
      })()}

      <div style={{ marginTop: 8 }}>
        <FacilityActions fac={fac} />
      </div>
    </div>
  );
}

function CitizenView({ c, state }: { c: Citizen; state: GameState }): React.ReactElement {
  const town = townOf(state);
  const employer = c.employerFirmId ? town.firms[c.employerFirmId] : null;
  const followedId = useGameStore((s) => s.followedCitizenId);
  const setFollow = useGameStore((s) => s.setFollow);
  const following = followedId === c.id;
  return (
    <div>
      <h3 style={{ margin: '0 0 2px' }}>
        {c.name}{' '}
        <button
          className={following ? 'primary' : ''}
          style={{ padding: '1px 8px', fontSize: 12, verticalAlign: 'middle' }}
          title={following
            ? 'Stop following (Esc or panning also breaks it)'
            : 'Camera follows this citizen through their day — commute, shopping, and (maybe) their climb up the prosperity ladder.'}
          onClick={() => setFollow(following ? null : c.id)}
        >
          {following ? '🎥 Following' : '🎥 Follow'}
        </button>
      </h3>
      <div className="small muted">{citizenActionLabel(c)}</div>
      <div className="kv small" style={{ marginTop: 6 }}>
        <span className="k">Cash</span><span className="mono">{formatMoney(c.cash)}</span>
      </div>
      <div className="kv small"><span className="k">Employer</span><span>{employer?.name ?? 'unemployed'}</span></div>
      <div className="kv small">
        <span className="k">Home</span>
        <span>
          {town.facilities[c.homeFacilityId]?.name ?? '—'}
          {town.facilities[c.homeFacilityId]?.defId === 'apartment' && (
            <span className="muted"> · pays {formatMoney(APARTMENT_RENT_PER_DAY)}/day rent</span>
          )}
        </span>
      </div>
      <div className="kv small"><span className="k">Wage / payday</span><span className="mono">{formatMoney(c.wage)}</span></div>
      <div className="kv small"><span className="k">Skill</span><span className="mono">{c.skill.toFixed(2)}× {c.skill >= 1.2 ? '★' : ''}</span></div>
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
          {getProduct(pid).name} ← {town.facilities[fid]?.name ?? fid}
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
      {firm.ceoName && (
        <div className="small" title={getPersonality(firm.personalityId).blurb} style={{ marginTop: 2 }}>
          CEO {firm.ceoName} · {getPersonality(firm.personalityId).icon}{' '}
          {getPersonality(firm.personalityId).name}
        </div>
      )}
      <div className="kv small" style={{ marginTop: 6 }}>
        <span className="k">Cash</span>
        <span className="mono" style={{ color: firm.cash < 0 ? 'var(--red)' : 'var(--green)' }}>{formatMoney(firm.cash)}</span>
      </div>
      <div className="kv small">
        <span className="k">Debt</span>
        <span className="mono" style={{ color: firm.debt > 0 ? 'var(--amber)' : undefined }}>{formatMoney(firm.debt)}</span>
      </div>
      {firm.ownerType === 'player' && <AdvisorCard state={state} />}
      {firm.ownerType === 'player' && <ExecutiveTeamCard firm={firm} state={state} />}
      {firm.ownerType === 'player' && <FinanceControls firmId={firm.id} />}
      {firm.ownerType === 'player' && <WageControls firm={firm} state={state} />}

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

/** The morning briefing: the game's insight streams as actionable one-liners. */
function AdvisorCard({ state }: { state: GameState }): React.ReactElement | null {
  const advice = morningBriefing(state);
  if (advice.length === 0) return null;
  const color = { danger: 'var(--red)', warning: 'var(--amber)', info: 'var(--text)' } as const;
  return (
    <div className="card" style={{ marginTop: 6 }}>
      <div className="section-title" style={{ margin: 0 }}>🧭 Advisor</div>
      {advice.map((a, i) => (
        <div className="small" key={i} style={{ color: color[a.severity], marginTop: 4 }}>
          {a.icon} {a.text}
        </div>
      ))}
    </div>
  );
}

/**
 * The executive team: firm-wide delegation. A logistics manager sizes shelf
 * contracts and sources wholesale; a sales manager works the ports. Store
 * managers are hired per-store from the store's inspector.
 */
function ExecutiveTeamCard({ firm, state }: { firm: Firm; state: GameState }): React.ReactElement {
  const dispatch = useGameStore((s) => s.dispatch);
  const day = computeTime(state.tick, state.config).day;
  const roles = [
    { role: 'logistics' as const, icon: '🚚', label: 'Logistics', blurb: 'sizes shelf contracts, sources wholesale' },
    { role: 'sales' as const, icon: '🚢', label: 'Sales', blurb: 'fills rush orders, sets standing exports' },
  ];
  const storeMgrs = firm.managers.filter((m) => m.role === 'store').length;
  return (
    <div className="card" style={{ marginTop: 6 }}>
      <div className="section-title" style={{ margin: 0 }}>👔 Executive team</div>
      {roles.map(({ role, icon, label, blurb }) => {
        const mgr = firm.managers.find((m) => m.role === role);
        if (mgr) {
          return (
            <div className="row small" key={role} style={{ gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
              <span title={`Duties: ${managerDuties(mgr.skill, role).join(', ')}`}>
                {icon} <strong>{mgr.name}</strong> — {label} · {formatMoney(mgr.salaryPerDay)}/day
              </span>
              <button
                style={{ padding: '1px 8px' }}
                onClick={() => dispatch({ type: 'FIRE_MANAGER', firmId: firm.id, managerId: mgr.id })}
              >
                Let go
              </button>
            </div>
          );
        }
        return (
          <div className="small" key={role} style={{ marginTop: 4 }}>
            <span className="muted" title={`Hire a ${label.toLowerCase()} manager — ${blurb}. Candidates rotate weekly.`}>
              {icon} {label} ({blurb}):
            </span>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
              {managerCandidates(state, day, role).map((c, i) => (
                <button
                  key={c.name}
                  style={{ padding: '1px 8px' }}
                  title={`${c.band} — duties: ${managerDuties(c.skill, role).join(', ')}`}
                  onClick={() => dispatch({ type: 'HIRE_MANAGER', firmId: firm.id, role, candidateIndex: i })}
                >
                  {c.name} ({c.band}, {formatMoney(c.salaryPerDay)}/day)
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <div className="muted small" style={{ marginTop: 4 }}>
        {storeMgrs > 0
          ? `${storeMgrs} store manager${storeMgrs === 1 ? '' : 's'} on payroll — see each store's inspector.`
          : 'Store managers are hired from each store\'s inspector.'}
      </div>
    </div>
  );
}

/**
 * The wage lever: pay above the poaching bar (1.15×) to pull skilled workers
 * from rivals — or watch yours walk when a rival out-pays you.
 */
function WageControls({ firm, state }: { firm: Firm; state: GameState }): React.ReactElement {
  const dispatch = useGameStore((s) => s.dispatch);
  const pop = populationStats(state);
  const rivalTop = rivalTopWage(state, firm.id);
  const wage = firm.wagePolicy.baseWage;
  const poachRisk = rivalTop >= wage * 1.15;
  const poachPower = wage >= rivalTop * 1.15;
  const beatMarket = Math.round(rivalTop * 1.16);
  return (
    <div className="card" style={{ marginTop: 6 }}>
      <div className="section-title" style={{ margin: 0 }}>Wages</div>
      <div className="kv small">
        <span className="k">Your base wage</span>
        <span className="mono">{formatMoney(wage)}/day</span>
      </div>
      <div className="kv small">
        <span className="k">Town average</span>
        <span className="mono">{formatMoney(pop.averageWage)}/day</span>
      </div>
      <div className="kv small">
        <span className="k">Top rival</span>
        <span className="mono">{formatMoney(rivalTop)}/day</span>
      </div>
      {poachRisk && (
        <div className="small" style={{ color: 'var(--amber)' }}>
          ⚠ A rival pays ≥1.15× your wage — your workers may defect.
        </div>
      )}
      {poachPower && (
        <div className="small" style={{ color: 'var(--green)' }}>
          ✓ You out-pay every rival by 15%+ — skilled workers will come to you.
        </div>
      )}
      <div className="row" style={{ gap: 6, marginTop: 4 }}>
        <button
          disabled={wage <= 100}
          onClick={() => dispatch({ type: 'SET_WAGE', firmId: firm.id, wage: Math.max(100, wage - 100) })}
        >
          −$1
        </button>
        <button onClick={() => dispatch({ type: 'SET_WAGE', firmId: firm.id, wage: wage + 100 })}>
          +$1
        </button>
        <button
          disabled={wage >= beatMarket}
          title="Set your wage 16% above the top rival — enough to poach their workers"
          onClick={() => dispatch({ type: 'SET_WAGE', firmId: firm.id, wage: beatMarket })}
        >
          Beat market — {formatMoney(beatMarket)}
        </button>
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>
        Applies to all {firm.employees.length} current employees immediately.
      </div>
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
  const town = townOf(state);
  return (
    <div>
      <h3 style={{ margin: '0 0 2px' }}>Shipment</h3>
      <div className="small muted">{town.firms[v.ownerFirmId]?.name}</div>
      <div className="kv small" style={{ marginTop: 6 }}>
        <span className="k">Cargo</span>
        <span className="mono">{Math.floor(v.cargo.quantity)} {getProduct(v.cargo.productId).name}</span>
      </div>
      <div className="kv small"><span className="k">From</span><span>{town.facilities[v.originFacilityId]?.name}</span></div>
      <div className="kv small"><span className="k">To</span><span>{town.facilities[v.destinationFacilityId]?.name}</span></div>
      <div className="kv small"><span className="k">Arrives in</span><span className="mono">{v.ticksUntilArrival} ticks</span></div>
      <div className="kv small"><span className="k">Transport cost</span><span className="mono">{formatMoney(v.transportCost)}</span></div>
    </div>
  );
}
