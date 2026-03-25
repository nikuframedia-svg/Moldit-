/** Apple-inspired dark industrial palette */
export const T = {
  bg: "#000000",
  card: "#0D0D0D",
  elevated: "#161616",
  hover: "#1C1C1E",
  border: "rgba(255,255,255,0.06)",
  borderHover: "rgba(255,255,255,0.12)",

  primary: "#F5F5F7",
  secondary: "#86868B",
  tertiary: "#48484A",

  blue: "#0A84FF",
  green: "#30D158",
  orange: "#FF9F0A",
  red: "#FF453A",
  purple: "#BF5AF2",
  yellow: "#FFD60A",
  teal: "#64D2FF",

  radius: 14,
  radiusSm: 10,

  mono: "ui-monospace,'SF Mono','Menlo','Consolas',monospace",
  sans: "-apple-system,'SF Pro Display','SF Pro Text','Helvetica Neue',sans-serif",
} as const;

/** Tool-id to color */
const TOOL_COLORS = [
  "#0A84FF", "#30D158", "#FF9F0A", "#FF453A", "#BF5AF2",
  "#64D2FF", "#FF6482", "#FFD60A", "#AC8E68", "#5E5CE6",
];

export function toolColor(toolId: string): string {
  const n = parseInt(toolId.replace(/\D/g, ""), 10) || 0;
  return TOOL_COLORS[n % TOOL_COLORS.length];
}
