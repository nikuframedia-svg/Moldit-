import { T } from "../../theme/tokens";
import { useMoldExplorerStore } from "../../stores/useMoldExplorerStore";
import { MoldSelector } from "./MoldSelector";
import { MoldGantt } from "./MoldGantt";
import { OpTable } from "./OpTable";
import { OptionsPanel } from "./OptionsPanel";

export function MoldExplorerPage() {
  const explorerData = useMoldExplorerStore((s) => s.explorerData);
  const selectedOpId = useMoldExplorerStore((s) => s.selectedOpId);
  const error = useMoldExplorerStore((s) => s.error);

  return (
    <div data-testid="explorer-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Mold selector */}
      <MoldSelector />

      {error && (
        <div style={{ fontSize: 12, color: T.red, padding: "8px 12px", background: `${T.red}11`, borderRadius: 8 }}>
          {error}
        </div>
      )}

      {/* Gantt zone */}
      <MoldGantt />

      {/* Options panel (when an op is selected) */}
      {selectedOpId !== null && <OptionsPanel />}

      {/* Operation table */}
      {explorerData && <OpTable />}
    </div>
  );
}
