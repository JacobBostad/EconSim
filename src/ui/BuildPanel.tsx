import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { BUILDABLE_DEFS } from '../sim/data/facilityDefinitions';
import { CHAIN_BLUEPRINTS, chainCost } from '../sim/data/chains';
import { getProduct } from '../sim/data/products';
import { formatMoney } from '../utils/formatMoney';
import { getPlayerFirm } from '../sim/selectors/companySelectors';
import { FESTIVAL_COST, FUND_HOME_COST } from '../sim/data/constants';

export function BuildPanel(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const buildDefId = useGameStore((s) => s.buildDefId);
  const setBuildDef = useGameStore((s) => s.setBuildDef);
  const state = sim.getState();
  const player = getPlayerFirm(state);
  const cash = player?.cash ?? 0;
  const festivalRunning = state.worldEvents.some((ev) => ev.defId === 'festival');

  return (
    <div>
      <div className="section-title">Build (click a building, then click the map)</div>
      <div className="small muted" style={{ marginBottom: 4 }}>
        Land near homes costs up to 1.6× to build and rent (0.8× on the outskirts) —
        but that's where the customers are.
      </div>
      {buildDefId && (
        <div className="card small">
          Placing <strong>{BUILDABLE_DEFS.find((d) => d.id === buildDefId)?.name}</strong>. Click an
          empty spot on the map.
          <div style={{ marginTop: 6 }}>
            <button onClick={() => setBuildDef(null)}>Cancel</button>
          </div>
        </div>
      )}
      {BUILDABLE_DEFS.map((def) => {
        const affordable = cash >= def.buildCost;
        return (
          <button
            key={def.id}
            className={`buildbtn ${buildDefId === def.id ? 'active' : ''}`}
            disabled={!affordable}
            onClick={() => setBuildDef(buildDefId === def.id ? null : def.id)}
            title={def.description}
          >
            {def.name} — {formatMoney(def.buildCost)}
            <small>{def.description}</small>
          </button>
        );
      })}
      <div className="section-title">Chain wizard (one click, fully wired)</div>
      {Object.values(CHAIN_BLUEPRINTS).map((bp) => {
        const cost = chainCost(bp);
        return (
          <button
            key={bp.productId}
            className="buildbtn"
            disabled={cash < cost}
            title={`Builds ${bp.producerDefId} → factory → store, selects recipes, staffs every stage, and wires both supply contracts.`}
            onClick={() => {
              const dispatch = useGameStore.getState().dispatch;
              dispatch({ type: 'BUILD_CHAIN', firmId: state.playerFirmId, productId: bp.productId });
            }}
          >
            🪄 {getProduct(bp.productId).name} chain — {formatMoney(cost)}
            <small>producer + factory + store, staffed &amp; wired</small>
          </button>
        );
      })}
      <div className="section-title">Civic actions</div>
      <button
        className="buildbtn"
        disabled={cash < FESTIVAL_COST || festivalRunning}
        title="3 days of boosted demand (+25% staples, +40% luxury) and looser wallets, town-wide."
        onClick={() =>
          useGameStore.getState().dispatch({ type: 'CIVIC_ACTION', firmId: state.playerFirmId, action: 'festival' })
        }
      >
        🎪 Sponsor festival — {formatMoney(FESTIVAL_COST)}
        <small>{festivalRunning ? 'already running!' : '3 days of packed shops (all sellers benefit)'}</small>
      </button>
      <button
        className="buildbtn"
        disabled={cash < FUND_HOME_COST}
        title="Builds a home and moves two new citizens in immediately — more workers and customers."
        onClick={() =>
          useGameStore.getState().dispatch({ type: 'CIVIC_ACTION', firmId: state.playerFirmId, action: 'fund_home' })
        }
      >
        🏡 Fund a home — {formatMoney(FUND_HOME_COST)}
        <small>2 new citizens move in (labor + customers)</small>
      </button>
      <div className="small muted" style={{ marginTop: 6 }}>
        Tip: the wizard is a starting point — tune prices, wages, ads, and R&amp;D
        in each facility's inspector to actually win the market.
      </div>
    </div>
  );
}
