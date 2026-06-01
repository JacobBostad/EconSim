import React from 'react';
import { useGameStore } from '../store/useGameStore';

/** First-run welcome / how-to-play overlay. Re-openable via the ? button. */
export function Intro(): React.ReactElement | null {
  const show = useGameStore((s) => s.showIntro);
  const setShow = useGameStore((s) => s.setShowIntro);
  if (!show) return null;

  return (
    <div className="intro-backdrop" onClick={() => setShow(false)}>
      <div className="intro-card" onClick={(e) => e.stopPropagation()}>
        <h1>🏙 EconSim</h1>
        <p className="muted">A living town economy — a Capitalism Lab in miniature.</p>

        <div className="intro-grid">
          <div>
            <h4>The world runs itself</h4>
            <p>40 citizens work, earn wages, and shop. Two AI companies run a
              <strong> bread chain</strong> (farm → bakery → store) and a
              <strong> tools chain</strong> (mine → factory → store). Trucks move
              goods; <strong>+$</strong> popups show real sales.</p>
          </div>
          <div>
            <h4>Inspect anything</h4>
            <p>Click a building, citizen, or truck. Drag to pan, scroll to zoom.
              Hover any underlined number to see the formula behind it. Open the
              dashboards (top bar) for Company, Market, Supply Chain & Population.</p>
          </div>
          <div>
            <h4>Run your company</h4>
            <p>You start with <strong>$15,000</strong>. Use <strong>Build</strong>
              (left) to place a Farm, Factory and Store, then in each building's
              inspector pick recipes, set a price, hire workers, and wire
              <strong> supply contracts</strong>. Undercut the AI to win customers.</p>
          </div>
          <div>
            <h4>Controls</h4>
            <p>Top-left: play/pause and speed (1× / 5× / 20× / 100×). The world
              <strong> auto-saves</strong> and resumes when you return. Hit
              <strong> New</strong> for a fresh random town.</p>
          </div>
        </div>

        <button className="intro-go" onClick={() => setShow(false)}>Enter the town →</button>
      </div>
    </div>
  );
}
