import React, { useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import type { Speed } from '../sim/core/Commands';
import { serialize, deserialize } from '../sim/persistence/saveLoad';
import { isMuted, setMuted } from './sound';

const SPEEDS: Speed[] = [1, 5, 20, 100];

export function Controls(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const togglePause = useGameStore((s) => s.togglePause);
  const save = useGameStore((s) => s.save);
  const load = useGameStore((s) => s.load);
  const setShowNewGame = useGameStore((s) => s.setShowNewGame);
  const hasSaveFn = useGameStore((s) => s.hasSave);
  const loadBackup = useGameStore((s) => s.loadBackup);
  const hasBackup = useGameStore((s) => s.hasBackup);
  const state = sim.getState();

  return (
    <div>
      <div className="section-title">Simulation</div>
      <div className="row">
        <button className={state.paused ? 'active' : ''} onClick={togglePause}>
          {state.paused ? '▶ Play' : '⏸ Pause'}
        </button>
        {SPEEDS.map((sp) => (
          <button
            key={sp}
            className={!state.paused && state.speed === sp ? 'active' : ''}
            onClick={() => setSpeed(sp)}
          >
            {sp}×
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <button onClick={save}>💾 Save</button>
        <button onClick={load} disabled={!hasSaveFn()}>📂 Load</button>
        <button onClick={() => setShowNewGame(true)}>🔄 New</button>
        {hasBackup() && (
          <button
            onClick={loadBackup}
            title="Restore the town you had before the last New Game"
          >
            ↩ Undo New
          </button>
        )}
        <MuteButton />
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <ExportImportButtons />
      </div>
    </div>
  );
}

/** Download the world as a JSON file / restore one — backups & sharing. */
function ExportImportButtons(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportSave = (): void => {
    const state = sim.getState();
    const blob = new Blob([serialize(state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const day = Math.floor(state.tick / (state.config.ticksPerHour * 24)) + 1;
    a.href = url;
    a.download = `econsim-day${day}-seed${state.seed}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importSave = (file: File): void => {
    void file.text().then((text) => {
      try {
        const loaded = deserialize(text);
        sim.setState(loaded);
        useGameStore.setState((s) => ({ version: s.version + 1 }));
      } catch {
        alert('That file is not a valid EconSim save.');
      }
    });
  };

  return (
    <>
      <button onClick={exportSave} title="Download this town as a JSON file">
        ⬆ Export
      </button>
      <button onClick={() => fileRef.current?.click()} title="Restore a town from an exported JSON file">
        ⬇ Import
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importSave(f);
          e.target.value = '';
        }}
      />
    </>
  );
}

function MuteButton(): React.ReactElement {
  const [muted, setMutedState] = useState(isMuted());
  return (
    <button
      title={muted ? 'Unmute sound effects' : 'Mute sound effects'}
      onClick={() => {
        setMuted(!muted);
        setMutedState(!muted);
      }}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}
