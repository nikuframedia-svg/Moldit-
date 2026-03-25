import { T } from "../../theme/tokens";

interface Props {
  children: React.ReactNode;
  size?: number;
  color?: string;
  mono?: boolean;
}

export function Num({ children, size = 32, color = T.primary, mono = true }: Props) {
  return (
    <span
      style={{
        fontSize: size,
        fontWeight: 600,
        color,
        letterSpacing: "-0.03em",
        fontFamily: mono ? T.mono : "inherit",
        fontFeatureSettings: "'tnum'",
      }}
    >
      {children}
    </span>
  );
}
