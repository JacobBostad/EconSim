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
            <p>Citizens work, earn wages, and shop. Rival firms with named
              CEOs run <strong>bread</strong>, <strong>tools</strong>, and
              <strong> clothes</strong> chains — nobody serves
              <strong> coffee</strong> yet. World events shake things up, the
              town grows when it prospers, and prosperity is cyclical: watch
              the trends in <strong>Population</strong>.</p>
          </div>
          <div>
            <h4>Trade, seasons, and the town</h4>
            <p>Export to <strong>Port Rosa</strong> when its prices spike (set
              standing orders in a warehouse). Brace for <strong>winter</strong>,
              sponsor <strong>festivals</strong>, fund homes, upgrade buildings —
              and unlock the <strong>luxury market</strong> with R&amp;D.</p>
          </div>
          <div>
            <h4>Run your company</h4>
            <p>Follow the <strong>Missions</strong> panel (left) — it pays cash
              rewards. Run a <strong>general store</strong> (up to 3 products —
              shoppers buy whole baskets), price to penetrate then charge a
              premium once you dominate, and staff up: extra hands raise output.</p>
          </div>
          <div>
            <h4>Compete on every lever</h4>
            <p><strong>Brand</strong> (ads), <strong>quality</strong> (R&amp;D),
              <strong> wages</strong> (out-pay rivals by 15% to poach their
              veterans — they answer back), <strong>finance</strong> (loans,
              shares, outright <strong>acquisitions</strong>), and
              <strong> real estate</strong> (apartments collect rent). The
              🧭 <strong>Advisor</strong> card tells you what needs attention;
              press <strong>F</strong> to see supply chains flow. Want a score?
              Start a 🏁 <strong>Challenge run</strong> from New Game.</p>
          </div>
        </div>

        <button className="intro-go" onClick={() => setShow(false)}>Enter the town →</button>
      </div>
    </div>
  );
}
