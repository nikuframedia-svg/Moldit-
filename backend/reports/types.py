"""Report types — Moldit Planner (Module B)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class ReportRecord:
    """Metadata for a generated report."""

    id: str
    tipo: str                    # "diario" | "semanal" | "cliente" | "incidente"
    created_at: str
    parametros: dict             # {date, week, molde_id, etc.}
    enviado: bool = False
    enviado_para: list[str] = field(default_factory=list)
