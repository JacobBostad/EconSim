import React from 'react';
import { useGameStore } from '../store/useGameStore';

/**
 * Announces that saving has stopped working.
 *
 * Autosave runs on a timer with no UI of its own, so a failed write used to be
 * completely invisible: the game kept playing, the town kept growing, and the
 * player found out only when they reopened the tab and the run was gone. The
 * failure this actually hits is a full storage quota — saves grow with the
 * town, and a Metropolis run is a large payload against a ~5 MB origin budget.
 *
 * Deliberately not a toast: a toast auto-hides, and this condition persists
 * until the player frees space. It stays until a save succeeds or it is
 * dismissed.
 */

const COPY: Record<string, { title: string; detail: string }> = {
  quota: {
    title: 'Your town has stopped saving',
    detail:
      'Browser storage is full. Delete an old save slot to free space. The run on screen is intact, but it will be lost when you close the tab.',
  },
  unknown: {
    title: 'Your town has stopped saving',
    detail:
      'The browser refused to write the save. The run on screen is intact, but it will be lost when you close the tab.',
  },
};

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} kB`;
  return `${bytes} B`;
}

export function SaveErrorBanner(): React.ReactElement | null {
  const saveError = useGameStore((s) => s.saveError);
  const dismiss = useGameStore((s) => s.dismissSaveError);

  if (!saveError) return null;

  const copy = COPY[saveError.reason] ?? COPY.unknown!;

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        top: 12,
        zIndex: 1000,
        maxWidth: 460,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: '10px 12px',
        background: '#3b1512',
        border: '1px solid #a2432f',
        borderRadius: 6,
        color: '#f6e3de',
        boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
      }}
    >
      <div style={{ flex: 1 }}>
        <strong style={{ display: 'block', marginBottom: 2 }}>{copy.title}</strong>
        <span style={{ fontSize: 13, lineHeight: 1.45, opacity: 0.9 }}>
          {copy.detail}
          {saveError.bytes !== undefined && (
            <> The save was {formatBytes(saveError.bytes)}.</>
          )}
        </span>
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        title="Dismiss"
        style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer' }}
      >
        ×
      </button>
    </div>
  );
}
