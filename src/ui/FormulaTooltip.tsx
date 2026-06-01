/**
 * FormulaTooltip — wraps a value with a hover explanation of how it's computed.
 * Used throughout the UI so every important number can explain itself.
 */

import React from 'react';

export function FormulaTooltip({
  children,
  title,
  explanation,
}: {
  children: React.ReactNode;
  title: string;
  explanation: React.ReactNode;
}): React.ReactElement {
  return (
    <span className="formula">
      {children}
      <span className="tip">
        <strong>{title}</strong>
        <div style={{ marginTop: 4 }}>{explanation}</div>
      </span>
    </span>
  );
}
