"""Calibration engine — Moldit Planner.

Computes calibration factors from real execution data (actual vs planned).
Feeds Monte Carlo with per-operation-type distributions instead of fixed CVs.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass


@dataclass(slots=True)
class CalibrationFactor:
    """Ratio of actual/planned duration for one operation type."""

    codigo: str
    ratio_media: float   # e.g. 1.15 = takes 15% longer than planned
    ratio_std: float     # standard deviation
    n_amostras: int
    confianca: float     # min(n/20, 1.0) — 100% at 20+ samples


@dataclass(slots=True)
class MachineReliability:
    """Machine reliability metrics from event history."""

    maquina_id: str
    uptime_pct: float    # e.g. 0.92 = 8% downtime
    mtbf_h: float        # mean time between failures
    mttr_h: float        # mean time to repair
    n_eventos: int


_MIN_SAMPLES = 5


def calcular_fatores_calibracao(
    logs: list[dict],
) -> dict[str, CalibrationFactor]:
    """Compute calibration factors grouped by operation code.

    Each log must have: codigo, work_h_planeado, work_h_real.
    Minimum 5 samples per code for confidence.
    """
    by_code: dict[str, list[float]] = defaultdict(list)

    for log in logs:
        planned = log.get("work_h_planeado", 0)
        actual = log.get("work_h_real")
        if not actual or not planned or planned <= 0:
            continue
        ratio = actual / planned
        if 0.1 < ratio < 10.0:  # sanity filter
            by_code[log["codigo"]].append(ratio)

    result: dict[str, CalibrationFactor] = {}
    for codigo, ratios in by_code.items():
        n = len(ratios)
        if n < _MIN_SAMPLES:
            continue
        media = sum(ratios) / n
        variance = sum((r - media) ** 2 for r in ratios) / max(n - 1, 1)
        std = math.sqrt(variance)
        result[codigo] = CalibrationFactor(
            codigo=codigo,
            ratio_media=round(media, 4),
            ratio_std=round(std, 4),
            n_amostras=n,
            confianca=round(min(n / 20.0, 1.0), 2),
        )

    return result


def calcular_fiabilidade_maquina(
    events: list[dict],
    regime_h: int = 16,
    periodo_dias: int = 90,
) -> MachineReliability:
    """Compute machine reliability from event history.

    Args:
        events: Machine events with tipo, duracao_h, planeado fields.
        regime_h: Daily operating hours for the machine.
        periodo_dias: Analysis period in working days.
    """
    maquina_id = events[0]["maquina_id"] if events else ""

    # Only unplanned events count as failures
    failures = [e for e in events if not e.get("planeado", False)]
    n_failures = len(failures)
    total_downtime_h = sum(e.get("duracao_h", 0) for e in failures)

    total_h = periodo_dias * regime_h
    uptime_pct = (total_h - total_downtime_h) / total_h if total_h > 0 else 1.0
    uptime_pct = max(0.0, min(1.0, uptime_pct))

    mtbf_h = total_h / n_failures if n_failures > 0 else total_h
    mttr_h = total_downtime_h / n_failures if n_failures > 0 else 0.0

    return MachineReliability(
        maquina_id=maquina_id,
        uptime_pct=round(uptime_pct, 4),
        mtbf_h=round(mtbf_h, 1),
        mttr_h=round(mttr_h, 1),
        n_eventos=n_failures,
    )
