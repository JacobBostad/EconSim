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

        <div className="card" style={{ margin: '10px 0 14px', padding: '10px 14px' }}>
          <h4 style={{ margin: '0 0 8px' }}>Your first ten minutes</h4>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
            <li>
              Click <strong>🚀 Bread chain</strong> in the left panel — you get a
              farm, a bakery, and a shop: built, staffed, wired, and priced.
            </li>
            <li>
              Set speed <strong>20×</strong> and watch the money move — green
              popups are sales, and the 🧭 <strong>Advisor</strong> (right)
              flags anything going wrong.
            </li>
            <li>
              Follow the <strong>Missions</strong> panel (top left) — each one
              pays cash and teaches one lever of the game.
            </li>
          </ol>
        </div>

        <p className="muted small" style={{ marginBottom: 6 }}>
          The deep game — skim now, come back with the <strong>?</strong> button:
        </p>
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
            <p>Export to <strong>Port Rosa</strong> or industrial
              <strong> Ironvale</strong> — the Gazette's Trade Desk shows which
              port pays (standing orders route there automatically), and once
              you own a warehouse, watch the ticker for <strong>rush
              orders</strong>: bulk deliveries on a deadline for a cash bonus.
              Brace for <strong>winter</strong>,
              sponsor <strong>festivals</strong>, fund homes, upgrade buildings —
              and unlock the <strong>luxury market</strong> with R&amp;D.</p>
          </div>
          <div>
            <h4>Run your company</h4>
            <p>Follow the <strong>Missions</strong> panel (left) — it pays cash
              rewards. Run a <strong>general store</strong> (up to 3 products —
              shoppers buy whole baskets), price to penetrate then charge a
              premium once you dominate, and staff up: extra hands raise output.
              Short on capital? Source shelves <strong>wholesale</strong> from
              rivals' factories at their asking price — or become the town's
              supplier and set your own.</p>
          </div>
          <div>
            <h4>Compete on every lever</h4>
            <p><strong>Brand</strong> (ads), <strong>quality</strong> (R&amp;D),
              <strong> wages</strong> (out-pay rivals by 15% to poach their
              veterans — they answer back — or 🎓 <strong>train</strong> your
              own crew up from the facility view), <strong>finance</strong> (loans,
              shares, outright <strong>acquisitions</strong> — and 🏷️
              <strong> fire-sale bargains</strong> in the ticker when a rival
              stumbles), and
              <strong> real estate</strong> (apartments collect rent). The
              🧭 <strong>Advisor</strong> card tells you what needs attention;
              press <strong>F</strong> to see supply chains flow. Want a score?
              Start a 🏁 <strong>Challenge run</strong> from New Game.</p>
          </div>
        </div>

        <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
          Keys: <strong>Space</strong> pause · <strong>1–4</strong> speed ·
          <strong> arrows</strong> pan · <strong>±</strong> zoom ·
          <strong> G</strong> gazette · <strong>C</strong> company ·
          <strong> M</strong> market · <strong>A</strong> awards ·
          <strong> F</strong> supply flows · <strong>Esc</strong> close
        </p>
        <button className="intro-go" onClick={() => setShow(false)}>Enter the town →</button>
      </div>
    </div>
  );
}
