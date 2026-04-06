"""Workforce management types — Moldit Planner."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class Operador:
    """Factory floor operator with competencies and availability."""

    id: str
    nome: str
    competencias: list[str]
    nivel: dict[str, int]
    turno: str
    zona: str
    disponivel: bool = True
    horas_semanais: float = 40.0


@dataclass(slots=True)
class CompetenciasMaquina:
    """Required competencies for operating a machine or machine group."""

    maquina_id: str
    grupo: str
    competencias_necessarias: list[str]
    nivel_minimo: int = 1
    n_operadores: int = 1


@dataclass(slots=True)
class WorkforceConflict:
    """A detected workforce conflict in a given day/shift slot.

    tipo: "sobreposicao" | "subdimensionamento" | "competencia" | "turno"
    severidade: "alta" | "media" | "baixa"
    """

    tipo: str
    dia: int
    turno: str
    maquinas: list[str]
    operadores_necessarios: int
    operadores_disponiveis: int
    deficit: int
    descricao: str
    severidade: str


@dataclass(slots=True)
class WorkforceAllocation:
    """An operator-to-machine assignment for a specific day/shift."""

    dia: int
    turno: str
    maquina_id: str
    operador_id: str
    auto: bool = False
