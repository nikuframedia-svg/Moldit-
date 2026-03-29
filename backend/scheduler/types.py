"""Moldit Scheduler — Internal Types."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class SegmentoMoldit:
    """A scheduled block on the Gantt chart."""
    op_id: int
    molde: str
    maquina_id: str
    dia: int
    inicio_h: float
    fim_h: float
    duracao_h: float
    setup_h: float = 0.0
    e_2a_placa: bool = False
    e_continuacao: bool = False
    progresso_antes: float = 0.0


@dataclass(slots=True)
class MachineState:
    """Tracks machine availability during dispatch."""
    machine_id: str
    group: str
    regime_h: int = 16
    available_at_h: float = 0.0
    last_op_id: int | None = None


@dataclass(slots=True)
class OperatorAlert:
    """Advisory when a machine group is overloaded."""
    dia: int
    grupo_maquina: str
    horas_necessarias: float
    horas_disponiveis: float
    deficit_h: float


@dataclass
class ScheduleResult:
    """Complete scheduler output."""
    segmentos: list[SegmentoMoldit] = field(default_factory=list)
    score: dict = field(default_factory=dict)
    time_ms: float = 0.0
    warnings: list[str] = field(default_factory=list)
    alerts: list[OperatorAlert] = field(default_factory=list)
    caminho_critico: list[int] = field(default_factory=list)
    makespan_por_molde: dict[str, float] = field(default_factory=dict)
    audit_trail: list | None = None
    journal: list | None = None
