import { T } from "../../theme/tokens";
import { useMoldExplorerStore } from "../../stores/useMoldExplorerStore";
import { MachineCard } from "./MachineCard";
import { TimingSlider } from "./TimingSlider";
import { ImpactSummary } from "./ImpactSummary";
import { CascadeList } from "./CascadeList";

export function OptionsPanel() {
  const opcoes = useMoldExplorerStore((s) => s.opcoes);
  const hoveredOption = useMoldExplorerStore((s) => s.hoveredOption);
  const loadingOpcoes = useMoldExplorerStore((s) => s.loadingOpcoes);
  const hoverOption = useMoldExplorerStore((s) => s.hoverOption);
  const applyChange = useMoldExplorerStore((s) => s.applyChange);
  const clearSelection = useMoldExplorerStore((s) => s.clearSelection);

  if (loadingOpcoes) {
    return (
      <div style={{ padding: 16, color: T.tertiary, fontSize: 12 }}>A carregar opcoes...</div>
    );
  }

  if (!opcoes) return null;

  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: T.primary }}>
            Opcoes para Op {opcoes.op_id}
          </span>
          <span style={{ fontSize: 11, color: T.tertiary, marginLeft: 8 }}>
            Atual: {opcoes.situacao_atual.maquina} | Dia {opcoes.situacao_atual.dia}
          </span>
        </div>
        <button
          onClick={clearSelection}
          style={{
            background: "none",
            border: "none",
            color: T.secondary,
            cursor: "pointer",
            fontSize: 16,
            fontFamily: "inherit",
          }}
        >
          x
        </button>
      </div>

      {/* Machine alternatives */}
      {opcoes.opcoes_maquina.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.secondary, marginBottom: 8 }}>
            Maquinas alternativas ({opcoes.opcoes_maquina.length})
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {opcoes.opcoes_maquina.map((opt) => (
              <MachineCard
                key={opt.maquina}
                option={opt}
                onHover={hoverOption}
                onApply={(machine) => applyChange(opcoes.op_id, machine)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Impact preview for hovered option */}
      {hoveredOption && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.secondary, marginBottom: 8 }}>
            Impacto: {hoveredOption.maquina}
          </div>
          <ImpactSummary impacto={hoveredOption.impacto} />
          <div style={{ marginTop: 8 }}>
            <CascadeList items={hoveredOption.cascata} />
          </div>
        </div>
      )}

      {/* Timing slider */}
      <TimingSlider
        earliest={opcoes.opcoes_timing.earliest}
        latest={opcoes.opcoes_timing.latest}
        atual={opcoes.opcoes_timing.atual}
      />

      {/* Swap options */}
      {opcoes.opcoes_sequencia.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.secondary, marginBottom: 6 }}>
            Trocas possiveis ({opcoes.opcoes_sequencia.length})
          </div>
          {opcoes.opcoes_sequencia.map((swap) => (
            <div
              key={swap.trocar_com}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 8px",
                background: T.elevated,
                borderRadius: 6,
                fontSize: 11,
                marginBottom: 4,
              }}
            >
              <span style={{ color: T.secondary }}>Op {swap.trocar_com}</span>
              <span style={{ color: T.tertiary }}>{swap.descricao}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
