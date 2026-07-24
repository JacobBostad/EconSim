import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { HOME_TOWN_ID } from '../sim/core/Town';
import { showSwitcher, townLabels, isHomeView, partnerBook } from './townView';
import { formatMoney } from '../utils/formatMoney';

/**
 * TownSwitcher — the region's town switcher (region.md step 5, first slice: the
 * player can LOOK at Port Rosa).
 *
 * A VIEW-ONLY control: it flips `selectedTownId` (store view-state, never
 * serialized) so the map renders the chosen town. It renders NOTHING unless the
 * region flag is on AND a partner town exists (`showSwitcher`), so a flag-off
 * game draws zero new chrome — the UI is byte-identical to before this slice.
 *
 * On a partner view it shows the town's read-only BOOK (crowd size, per-product
 * price + export cover) and a plain affordance that the player does not operate
 * there yet; the map's build/select guards (MapView) enforce that promise.
 */
export function TownSwitcher(): React.ReactElement | null {
  // Subscribe to version so the book refreshes as the partner economy ticks.
  useGameStore((s) => s.version);
  const selectedTownId = useGameStore((s) => s.selectedTownId);
  const setSelectedTownId = useGameStore((s) => s.setSelectedTownId);
  const state = useGameStore((s) => s.sim.getState());

  if (!showSwitcher(state)) return null;

  const labels = townLabels(state);
  const homeView = isHomeView(selectedTownId);
  const book = homeView ? undefined : partnerBook(state, selectedTownId);

  return (
    <div className="town-switcher">
      <div className="town-switcher-tabs">
        {labels.map((t) => (
          <button
            key={t.id}
            className={t.id === selectedTownId ? 'active' : ''}
            onClick={() => setSelectedTownId(t.id)}
            title={t.id === HOME_TOWN_ID ? 'Your town — you operate here' : `Look at ${t.name} (live economy)`}
          >
            {t.emoji} {t.name}
          </button>
        ))}
      </div>

      {book && (
        <div className="town-book">
          <div className="town-book-head">
            <span className="town-book-title">
              {book.label.emoji} {book.label.name}
            </span>
            <span className="town-book-crowd">👥 {book.crowd.toLocaleString()} crowd</span>
          </div>
          <div className="town-book-note">You don’t operate here — yet.</div>
          {book.rows.length > 0 ? (
            <table className="town-book-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Price</th>
                  <th>Cover</th>
                </tr>
              </thead>
              <tbody>
                {book.rows.map((r) => (
                  <tr key={r.productId}>
                    <td>{r.name}</td>
                    <td className="mono">{r.price > 0 ? formatMoney(r.price) : '—'}</td>
                    <td className="mono">
                      {r.coverDays === undefined
                        ? '—'
                        : r.coverDays >= 100
                          ? '99+ d'
                          : `${r.coverDays.toFixed(1)} d`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="town-book-note muted">Its market has no book yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
