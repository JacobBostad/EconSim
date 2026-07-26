import React, { useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import type { Speed } from '../sim/core/Commands';
import {
  serialize, deserialize, loadGame, listSaves, removeSave, saveMeta,
} from '../sim/persistence/saveLoad';
import { getScenario } from '../sim/data/scenarios';
import { formatMoney } from '../utils/formatMoney';
import { isMuted, setMuted } from './sound';
import { isMusicOn, setMusicOn, startMusic } from './music';

const SPEEDS: Speed[] = [1, 5, 20, 100];

export function Controls(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  // Route manual saves through the store too, so a full quota raises the same
  // banner an autosave failure does instead of silently doing nothing.
  const persistState = useGameStore((s) => s.persistState);
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
        <SaveSlots />
      </div>
    </div>
  );
}

/** Reserved slots the UI manages implicitly (autosave / Undo-New stash). */
const SYSTEM_SLOTS = new Set(['default', 'backup']);

/** Named save slots: park a town, try something risky, come back. */
function SaveSlots(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [bump, setBump] = useState(0); // re-list after save/delete

  const slots = open
    ? listSaves().filter((s) => !SYSTEM_SLOTS.has(s)).sort()
    : [];
  void bump;

  const loadSlot = (slot: string): void => {
    const loaded = loadGame(slot);
    if (loaded) {
      sim.setState(loaded);
      useGameStore.setState((s) => ({ version: s.version + 1 }));
      setOpen(false);
    }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} title="Named save slots — park towns and switch between them">
        🗂 Slots
      </button>
      {open && (
        <div className="intro-backdrop" onClick={() => setOpen(false)}>
          <div className="intro-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px' }}>🗂 Save slots</h3>
            {slots.length === 0 && (
              <p className="muted small">No named saves yet — name one below.</p>
            )}
            {slots.map((slot) => {
              const meta = saveMeta(slot);
              return (
                <div className="row between small" key={slot} style={{ marginBottom: 4, gap: 8 }}>
                  <span>
                    <strong>{slot}</strong>
                    {meta && (
                      <span className="muted">
                        {' '}— day {meta.day}, {getScenario(meta.scenarioId).name},{' '}
                        {meta.citizens} citizens, {formatMoney(meta.playerCash)}
                      </span>
                    )}
                  </span>
                  <span className="row" style={{ gap: 4 }}>
                    <button onClick={() => loadSlot(slot)}>Load</button>
                    <button onClick={() => { persistState(sim.getState(), slot); setBump((b) => b + 1); }} title="Overwrite with the current town">
                      Overwrite
                    </button>
                    <button onClick={() => { removeSave(slot); setBump((b) => b + 1); }} title="Delete this save">
                      ×
                    </button>
                  </span>
                </div>
              );
            })}
            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              <input
                placeholder="slot name…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                disabled={!name.trim() || SYSTEM_SLOTS.has(name.trim())}
                onClick={() => {
                  persistState(sim.getState(), name.trim());
                  setName('');
                  setBump((b) => b + 1);
                }}
              >
                Save as
              </button>
              <button onClick={() => setOpen(false)}>Close</button>
            </div>
            <p className="muted small" style={{ marginTop: 6 }}>
              The autosave and the ↩ Undo-New stash are managed automatically
              and aren't listed here.
            </p>
          </div>
        </div>
      )}
    </>
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
  const [music, setMusicState] = useState(isMusicOn());
  return (
    <>
      <button
        title={muted ? 'Unmute sound effects' : 'Mute sound effects'}
        onClick={() => {
          setMuted(!muted);
          setMutedState(!muted);
        }}
      >
        {muted ? '🔇' : '🔊'}
      </button>
      <button
        title={music ? 'Turn off ambient music' : 'Turn on ambient music'}
        style={music ? undefined : { opacity: 0.45 }}
        onClick={() => {
          setMusicOn(!music);
          setMusicState(!music);
          if (!music) startMusic(); // click is the user gesture — start now
        }}
      >
        🎵
      </button>
    </>
  );
}
