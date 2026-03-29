"""Stress map — Moldit Planner.

Per-machine stress analysis: total hours, capacity, stress percentage, peak day.
"""

from __future__ import annotations

from collections import defaultdict

from backend.config.types import FactoryConfig
from backend.scheduler.types import SegmentoMoldit
from backend.types import Maquina


def compute_stress(
    segmentos: list[SegmentoMoldit],
    machines: dict[str, Maquina],
    config: FactoryConfig | None = None,
) -> dict[str, dict]:
    """Compute stress metrics per machine.

    Returns {machine_id: {total_horas, capacidade, stress_pct, pico_dia, pico_horas}}.
    """
    if not segmentos:
        return {}

    max_day = max(s.dia for s in segmentos)
    n_days = max_day + 1

    # Accumulate hours per machine
    total_per_machine: dict[str, float] = defaultdict(float)
    hours_per_machine_day: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))

    for seg in segmentos:
        total_per_machine[seg.maquina_id] += seg.duracao_h
        hours_per_machine_day[seg.maquina_id][seg.dia] += seg.duracao_h

    result: dict[str, dict] = {}
    for mid in sorted(total_per_machine.keys()):
        m = machines.get(mid)
        regime_h = m.regime_h if m else 16
        total_h = total_per_machine[mid]

        if regime_h > 0:
            capacity = n_days * regime_h
            stress_pct = round((total_h / capacity) * 100, 1) if capacity > 0 else 0.0
        else:
            capacity = 0
            stress_pct = 0.0  # External resources, no stress

        # Peak day
        day_hours = hours_per_machine_day[mid]
        if day_hours:
            pico_dia = max(day_hours, key=day_hours.get)
            pico_horas = round(day_hours[pico_dia], 1)
        else:
            pico_dia = 0
            pico_horas = 0.0

        result[mid] = {
            "total_horas": round(total_h, 1),
            "capacidade": capacity,
            "stress_pct": stress_pct,
            "pico_dia": pico_dia,
            "pico_horas": pico_horas,
        }

    return result
