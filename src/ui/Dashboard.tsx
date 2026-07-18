import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { CompanyDashboard } from './CompanyDashboard';
import { MarketDashboard } from './MarketDashboard';
import { SupplyChainDashboard } from './SupplyChainDashboard';
import { PopulationDashboard } from './PopulationDashboard';
import { DebugPanel } from './DebugPanel';
import { AwardsDashboard } from './AwardsDashboard';
import { GazetteDashboard } from './GazetteDashboard';

export function Dashboard(): React.ReactElement {
  const dashboard = useGameStore((s) => s.dashboard);
  const setDashboard = useGameStore((s) => s.setDashboard);

  return (
    <div className="dash-overlay">
      <div className="row between">
        <h2 style={{ margin: 0, textTransform: 'capitalize' }}>{dashboard} dashboard</h2>
        <button onClick={() => setDashboard('none')}>✕ Close</button>
      </div>
      <div style={{ marginTop: 10 }}>
        {dashboard === 'company' && <CompanyDashboard />}
        {dashboard === 'market' && <MarketDashboard />}
        {dashboard === 'supply' && <SupplyChainDashboard />}
        {dashboard === 'population' && <PopulationDashboard />}
        {dashboard === 'awards' && <AwardsDashboard />}
        {dashboard === 'gazette' && <GazetteDashboard />}
        {dashboard === 'debug' && <DebugPanel />}
      </div>
    </div>
  );
}
