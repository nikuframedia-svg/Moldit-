"""Alert types — Moldit Planner.

Dataclasses for the alert engine output.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class AlertSuggestion:
    """A suggested corrective action for an alert."""

    acao: str
    impacto: str
    esforco: str  # "baixo" | "medio" | "alto"
    mutation_type: str | None = None
    mutation_params: dict = field(default_factory=dict)


@dataclass(slots=True)
class Alert:
    """A single alert raised by the engine."""

    id: str
    regra: str  # "R1", "R2", ...
    severidade: str  # "critico" | "aviso" | "info"
    titulo: str
    mensagem: str
    timestamp: str  # ISO 8601
    moldes_afetados: list[str]
    maquinas_afetadas: list[str]
    operacoes: list[int]
    impacto_dias: float
    sugestoes: list[AlertSuggestion]
    estado: str = "ativo"  # "ativo" | "reconhecido" | "resolvido" | "ignorado"
