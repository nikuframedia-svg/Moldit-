"""Day summary — textual description of what happens on a given day and why.

Generates Portuguese text describing production, setups, and risks.
Uses Moldit SegmentoMoldit (grouped by molde, not by sku).
"""

from __future__ import annotations

from collections import defaultdict

from backend.config.types import FactoryConfig
from backend.scheduler.types import SegmentoMoldit as Segment
from backend.types import MolditEngineData as EngineData


def _build_op_lookup(engine_data: EngineData) -> dict[int, object]:
    """Map op_id -> Operacao for quick lookups."""
    return {op.id: op for op in engine_data.operacoes}


def compute_day_summary(
    segments: list[Segment],
    engine_data: EngineData,
    config: FactoryConfig,
    day_idx: int,
    machines_data: dict,
    actions: list,
) -> list[dict]:
    """Build a list of summary lines for a given day.

    Each line: {"text": "...", "color": "red"|"green"|"orange"|"default"}
    """
    lines: list[dict] = []
    day_segs = [s for s in segments if s.dia == day_idx]
    feriados = set(engine_data.feriados or [])

    # No production -- explain why
    if not day_segs:
        if str(day_idx) in feriados or day_idx in feriados:
            lines.append({"text": "Feriado -- sem producao.", "color": "orange"})
        else:
            lines.append({
                "text": "Sem producao planeada. Capacidade disponivel.",
                "color": "default",
            })
        return lines

    # --- Production summary by molde ---
    by_molde: dict[str, list[Segment]] = defaultdict(list)
    for s in day_segs:
        by_molde[s.molde].append(s)

    active_machines = sorted(set(s.maquina_id for s in day_segs))
    total_h = sum(s.duracao_h for s in day_segs)
    total_setups = sum(1 for s in day_segs if s.setup_h > 0)

    n_maq = len(active_machines)
    lines.append({
        "text": (
            f"Producao: {total_h:.1f}h em {n_maq} "
            f"maquina{'s' if n_maq > 1 else ''}. "
            f"{total_setups} setup{'s' if total_setups != 1 else ''}."
        ),
        "color": "default",
    })

    # --- Per-molde detail ---
    for molde_id, molde_segs in sorted(by_molde.items()):
        molde_h = sum(s.duracao_h for s in molde_segs)
        machines_used = sorted(set(s.maquina_id for s in molde_segs))
        lines.append({
            "text": f"  {molde_id}: {molde_h:.1f}h em {', '.join(machines_used)}",
            "color": "default",
        })

    # --- Per-machine utilization ---
    for m_id in active_machines:
        m_segs = [s for s in day_segs if s.maquina_id == m_id]
        m_h = sum(s.duracao_h + s.setup_h for s in m_segs)
        m_setups = sum(1 for s in m_segs if s.setup_h > 0)

        # Find machine regime
        machine = next((m for m in engine_data.maquinas if m.id == m_id), None)
        regime_h = machine.regime_h if machine else 16
        m_util = round(m_h / regime_h * 100, 1) if regime_h > 0 else 0

        line = f"  {m_id}: {m_h:.1f}h, {m_util}% util."
        if m_setups > 0:
            line += f" {m_setups} setup{'s' if m_setups > 1 else ''}."

        color = "red" if m_util > 95 else "orange" if m_util > 85 else "default"
        lines.append({"text": line, "color": color})

    # --- Alerts ---
    for a in actions:
        if a.category == "deadline" and a.severity == "critical":
            lines.append({"text": f"CRITICO: {a.phrase}", "color": "red"})
        elif a.category == "bottleneck":
            lines.append({"text": f"ALERTA: {a.phrase}", "color": "orange"})

    # --- High utilization warnings ---
    for m in machines_data.get("machines", []):
        util = m.get("util", 0) * 100
        if util > 95:
            lines.append({
                "text": f"RISCO: {m['id']} a {util:.0f}% utilizacao -- capacidade quase esgotada.",
                "color": "red",
            })

    return lines
