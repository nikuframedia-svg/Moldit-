"""Workforce forecast — Moldit Planner.

Projects operator needs N weeks ahead by analysing scheduled segments,
grouping by zone/shift, and comparing with available operators.
"""

from __future__ import annotations

import logging
from collections import defaultdict

from backend.config.types import FactoryConfig
from backend.workforce.types import CompetenciasMaquina, Operador

logger = logging.getLogger(__name__)

# Working days per week (standard)
_DAYS_PER_WEEK = 5

# Default hours per shift
_DEFAULT_SHIFT_H = 8.5


def forecast_necessidades(
    segmentos: list,
    operadores: list[Operador],
    competencias: dict[str, CompetenciasMaquina],
    config: FactoryConfig | None = None,
    semanas: int = 4,
) -> list[dict]:
    """Forecast workforce needs for the next *semanas* weeks.

    Returns a list of dicts, one per (semana, zona, turno) combination:
    {
        "semana": int,        # 1-based week index
        "zona": str,          # machine group / zone
        "turno": str,         # shift ID
        "necessarios": int,   # operators needed (peak in week)
        "disponiveis": int,   # operators available
        "deficit": int,       # shortfall (0 if no deficit)
        "horas_extra_h": float  # estimated overtime hours to cover deficit
    }
    """
    if not segmentos:
        return []

    shift_ids = [s.id for s in config.shifts] if config and config.shifts else ["A", "B"]
    shift_h = (
        config.shifts[0].duration_min / 60.0
        if config and config.shifts
        else _DEFAULT_SHIFT_H
    )

    min_dia = min(s.dia for s in segmentos)
    max_dia = max(s.dia for s in segmentos)

    # Cap to requested weeks
    horizon_dias = semanas * _DAYS_PER_WEEK
    end_dia = min(min_dia + horizon_dias, max_dia + 1)

    # ── Pre-index operators by (zona, turno) ───────────────────────────
    ops_by_zone_shift: dict[tuple[str, str], list[Operador]] = defaultdict(list)
    for op in operadores:
        if not op.disponivel:
            continue
        ops_by_zone_shift[(op.zona, op.turno)].append(op)

    # ── Collect per-week peak machine counts by (zona, turno) ──────────
    # zone derived from competencias group mapping
    machine_zone: dict[str, str] = {}
    for mid, cr in competencias.items():
        machine_zone[mid] = cr.grupo

    # week_needs: {(week, zone, shift): peak_count_per_day}
    week_day_counts: dict[tuple[int, str, str], dict[int, int]] = defaultdict(
        lambda: defaultdict(int),
    )

    for seg in segmentos:
        if seg.dia < min_dia or seg.dia >= end_dia:
            continue
        week = (seg.dia - min_dia) // _DAYS_PER_WEEK + 1
        zone = machine_zone.get(seg.maquina_id, "Outro")
        # Determine shift from segment start hour
        turno = _shift_for_hour(seg.inicio_h, config, shift_ids)
        week_day_counts[(week, zone, turno)][seg.dia] += 1

    # ── Build result ──────────────────────────────────────────────────
    results: list[dict] = []
    seen: set[tuple[int, str, str]] = set()

    for (week, zone, turno), day_counts in sorted(week_day_counts.items()):
        key = (week, zone, turno)
        if key in seen:
            continue
        seen.add(key)

        # Peak concurrent machines in this week for this zone/shift
        peak_machines = max(day_counts.values()) if day_counts else 0

        # Available operators for this zone+shift
        available = len(ops_by_zone_shift.get((zone, turno), []))

        # Also count operators whose zona matches broadly
        # (operators may list group name as zona)
        if available == 0:
            for (oz, ot), op_list in ops_by_zone_shift.items():
                if ot == turno and oz == zone:
                    available += len(op_list)

        deficit = max(0, peak_machines - available)
        horas_extra = deficit * shift_h * _DAYS_PER_WEEK if deficit > 0 else 0.0

        results.append({
            "semana": week,
            "zona": zone,
            "turno": turno,
            "necessarios": peak_machines,
            "disponiveis": available,
            "deficit": deficit,
            "horas_extra_h": round(horas_extra, 1),
        })

    return results


def _shift_for_hour(
    hora_h: float,
    config: FactoryConfig | None,
    shift_ids: list[str],
) -> str:
    """Map fractional hour to shift ID."""
    hora_min = hora_h * 60
    if config and config.shifts:
        for s in config.shifts:
            if s.start_min <= hora_min < s.end_min:
                return s.id
        return config.shifts[-1].id
    return "A" if hora_min < 930 else "B"
