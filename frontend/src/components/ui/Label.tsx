import type { CSSProperties } from "react";
import { T } from "../../theme/tokens";

interface Props {
  children: React.ReactNode;
  style?: CSSProperties;
}

export function Label({ children, style }: Props) {
  return (
    <span style={{ fontSize: 12, color: T.secondary, fontWeight: 500, letterSpacing: "0.01em", ...style }}>
      {children}
    </span>
  );
}
