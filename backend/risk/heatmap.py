"""Heatmap — Moldit Planner.

Grid: machines × days. Each cell: utilisation + min slack of active ops.
"""

from __future__ import annotations

from collections import defaultdict

from backend.config.types import FactoryConfig
from backend.scheduler.types import SegmentoMoldit as Segment
from backend.types import MolditEngineData as EngineData

from .types import HeatmapCell, OpRisk


def compute_heatmap(
    segments: list[Segment],
    op_risks: list[OpRisk],
    engine_data: EngineData,
    config: FactoryConfig | None = None,
) -> list[HeatmapCell]:
    """Build risk heatmap grid.

    Risk levels:
      low:      util < 0.70 AND slack > 1440 min (24h)
      medium:   util 0.70-0.85 OR slack 480-1440 min
      high:     util 0.85-0.95 OR slack 120-480 min
      critical: util > 0.95 OR slack < 120 min (2h)
    """
    if not segments:
        return []

    n_days = max(s.dia for s in segments) + 1

    # Minutes used per (machine, day)
    used: dict[tuple[str, int], float] = defaultdict(float)
    for seg in segments:
        used[(seg.maquina_id, seg.dia)] += (seg.duracao_h + seg.setup_h) * 60

    # Min slack per (machine, day) from op risks
    risk_by_op: dict[int, OpRisk] = {lr.op_id: lr for lr in op_risks}
    min_slack: dict[tuple[str, int], float] = {}
    for seg in segments:
        lr = risk_by_op.get(seg.op_id)
        if lr:
            key = (seg.maquina_id, seg.dia)
            if key not in min_slack or lr.slack_min < min_slack[key]:
                min_slack[key] = lr.slack_min

    cells: list[HeatmapCell] = []
    for m in engine_data.maquinas:
        if m.regime_h == 0:
            continue  # skip external
        machine_cap = m.regime_h * 60
        for d in range(n_days):
            util = used.get((m.id, d), 0) / machine_cap if machine_cap > 0 else 0
            slack = min_slack.get((m.id, d), -1.0)

            if util > 0.95 or (slack >= 0 and slack < 120):
                level = "critical"
            elif util > 0.85 or (slack >= 0 and slack < 480):
                level = "high"
            elif util > 0.70 or (slack >= 0 and slack < 1440):
                level = "medium"
            else:
                level = "low"

            cells.append(HeatmapCell(
                machine_id=m.id,
                day_idx=d,
                utilization=round(util, 3),
                min_slack_min=round(slack, 1),
                risk_level=level,
            ))

    return cells
