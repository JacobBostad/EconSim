import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { EventLog } from './EventLog';
import { bottlenecks } from '../sim/selectors/supplyChainSelectors';

export function BottomBar(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const select = useGameStore((s) => s.select);
  const state = sim.getState();
  const necks = bottlenecks(state);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', height: '100%' }}>
      <div style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div className="section-title" style={{ padding: '4px 10px 0', margin: 0 }}>Event Log</div>
        <EventLog />
      </div>
      <div style={{ overflowY: 'auto' }}>
        <div className="section-title" style={{ padding: '4px 10px 0', margin: 0 }}>
          Bottlenecks ({necks.length})
        </div>
        <div style={{ padding: '0 10px' }}>
          {necks.length === 0 && <div className="muted small">No active bottlenecks.</div>}
          {(() => {
            // Group identical reasons: a town-wide surplus used to print seven
            // near-identical "Output storage full" rows.
            const groups = new Map<string, typeof necks>();
            for (const b of necks) {
              const g = groups.get(b.reason) ?? [];
              g.push(b);
              groups.set(b.reason, g);
            }
            return Array.from(groups.entries()).map(([reason, rows]) =>
              rows.length >= 3 ? (
                <div className="small" key={reason} style={{ color: 'var(--amber)', padding: '2px 0' }}>
                  ⚠ {rows.length} facilities: {reason}
                  {reason === 'Output storage full' ? ' — more supply than the town buys' : ''}
                  <div className="muted" style={{ paddingLeft: 14 }}>
                    {rows.map((b, i) => (
                      <span key={b.facilityId}>
                        <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => select(b.facilityId)}>
                          {b.facilityName}
                        </span>
                        {i < rows.length - 1 ? ', ' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                rows.map((b) => (
                  <div
                    className="small"
                    key={b.facilityId}
                    style={{ cursor: 'pointer', color: 'var(--amber)', padding: '2px 0' }}
                    onClick={() => select(b.facilityId)}
                  >
                    ⚠ {b.facilityName}: {b.reason}
                  </div>
                ))
              ),
            );
          })()}
        </div>
      </div>
    </div>
  );
}
