/** ExplainBox — the most important component.
 *
 * Every number, prediction, or suggestion is accompanied by this box.
 * Shows: headline (always), detail (expandable), source, confidence.
 * Follows: O QUÊ + PORQUE + IMPACTO + AÇÃO pattern.
 */

import { useState, type ReactNode } from "react";
import { T } from "../theme/tokens";

const COLOR_MAP: Record<string, string> = {
  green: T.green,
  verde: T.green,
  orange: T.orange,
  laranja: T.orange,
  red: T.red,
  vermelho: T.red,
  blue: T.blue,
};

interface ExplainBoxProps {
  /** Main phrase — always visible. */
  headline: string;
  /** Longer explanation — shown when expanded. */
  detail?: string;
  /** Where the data comes from. */
  source?: string;
  /** 'alta' | 'media' | 'baixa' */
  confidence?: string;
  /** Suggested action. */
  suggestion?: string;
  /** Color: verde/laranja/vermelho or green/orange/red. */
  color?: string;
  /** Optional action button. */
  action?: { label: string; onClick: () => void };
  /** Children rendered below the headline. */
  children?: ReactNode;
}

export function ExplainBox({
  headline,
  detail,
  source,
  confidence,
  suggestion,
  color,
  action,
  children,
}: ExplainBoxProps) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = !!(detail || source || confidence || suggestion);
  const accentColor = color ? COLOR_MAP[color] || T.secondary : undefined;

  return (
    <div
      style={{
        borderLeft: accentColor ? `3px solid ${accentColor}` : undefined,
        paddingLeft: accentColor ? 12 : 0,
        marginBottom: 4,
      }}
    >
      {/* Headline — always visible */}
      <div
        onClick={hasMore ? () => setExpanded(!expanded) : undefined}
        style={{
          fontSize: 14,
          color: T.primary,
          lineHeight: 1.5,
          cursor: hasMore ? "pointer" : "default",
        }}
      >
        {headline}
        {hasMore && !expanded && (
          <span style={{ color: T.tertiary, fontSize: 11, marginLeft: 6 }}>
            (ver mais)
          </span>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ marginTop: 6, fontSize: 13, color: T.secondary, lineHeight: 1.6 }}>
          {detail && <div style={{ whiteSpace: "pre-line" }}>{detail}</div>}
          {source && (
            <div style={{ marginTop: 4, fontSize: 11, color: T.tertiary, fontStyle: "italic" }}>
              {source}
            </div>
          )}
          {confidence && (
            <div style={{ marginTop: 2, fontSize: 11, color: T.tertiary }}>
              Confianca: {confidence}
            </div>
          )}
          {suggestion && (
            <div style={{ marginTop: 6, fontSize: 13, color: T.blue }}>
              {suggestion}
            </div>
          )}
        </div>
      )}

      {/* Action button */}
      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: 6,
            padding: "5px 14px",
            borderRadius: 6,
            border: "none",
            background: T.blue,
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {action.label}
        </button>
      )}

      {children}
    </div>
  );
}
