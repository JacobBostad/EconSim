import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { TopBar } from './TopBar';
import { BuildPanel } from './BuildPanel';
import { Controls } from './Controls';
import { MapView } from './MapView';
import { InspectorPanel } from './InspectorPanel';
import { BottomBar } from './BottomBar';
import { Dashboard } from './Dashboard';
import { Intro } from './Intro';
import { ObjectiveBanner } from './ObjectiveBanner';
import { WorldEventTicker } from './WorldEventTicker';
import { AchievementToast } from './AchievementToast';
import { NewGameModal } from './NewGameModal';
import { MissionPanel } from './MissionPanel';
import { SoundDirector } from './SoundDirector';
import { MusicDirector } from './MusicDirector';
import { ReportCardModal } from './ReportCardModal';
import { ReceivershipModal } from './ReceivershipModal';
import { FinalScoreModal } from './FinalScoreModal';
import { RecordsTracker } from './RecordsTracker';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { ChronicleModal } from './ChronicleModal';

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
        <MissionPanel />
        <BuildPanel />
      </div>
      <div className="center">
        <MapView />
        <WorldEventTicker />
        <ObjectiveBanner />
        <AchievementToast />
        {dashboard !== 'none' && <Dashboard />}
      </div>
      <div className="right panel">
        <InspectorPanel />
      </div>
      <div className="bottom panel">
        <BottomBar />
      </div>
      <Intro />
      <NewGameModal />
      <ReportCardModal />
      <ReceivershipModal />
      <FinalScoreModal />
      <SoundDirector />
      <MusicDirector />
      <RecordsTracker />
      <KeyboardShortcuts />
      <ChronicleModal />
    </div>
  );
}
