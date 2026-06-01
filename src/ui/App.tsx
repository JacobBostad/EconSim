import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { TopBar } from './TopBar';
import { BuildPanel } from './BuildPanel';
import { Controls } from './Controls';
import { MapView } from './MapView';
import { InspectorPanel } from './InspectorPanel';
import { BottomBar } from './BottomBar';
import { Dashboard } from './Dashboard';

export function App(): React.ReactElement {
  // Subscribe to version so the whole tree re-renders as the sim advances.
  useGameStore((s) => s.version);
  const dashboard = useGameStore((s) => s.dashboard);

  return (
    <div className="app">
      <div className="top">
        <TopBar />
      </div>
      <div className="left panel">
        <Controls />
        <BuildPanel />
      </div>
      <div className="center">
        <MapView />
        {dashboard !== 'none' && <Dashboard />}
      </div>
      <div className="right panel">
        <InspectorPanel />
      </div>
      <div className="bottom panel">
        <BottomBar />
      </div>
    </div>
  );
}
