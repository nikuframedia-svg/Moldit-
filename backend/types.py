"""Moldit Planner — Core Types.

Central data contract for the mold production scheduler.
All modules import from here.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class Operacao:
    """A single operation from the MPP plan."""
    id: int
    molde: str
    componente: str
    nome: str
    codigo: str
    nome_completo: str
    duracao_h: float
    work_h: float
    progresso: float  # 0.0–100.0
    work_restante_h: float
    data_inicio: str | None = None
    data_fim: str | None = None
    recurso: str | None = None
    grupo_recurso: str | None = None
    e_condicional: bool = False
    e_2a_placa: bool = False
    deadline_semana: str | None = None
    notas: str | None = None


@dataclass(slots=True)
class Molde:
    """A mold (project) being produced."""
    id: str
    cliente: str
    deadline: str
    data_ensaio: str | None = None
    componentes: list[str] = field(default_factory=list)
    total_ops: int = 0
    ops_concluidas: int = 0
    progresso: float = 0.0
    total_work_h: float = 0.0


@dataclass(slots=True)
class Maquina:
    """A machine or work station."""
    id: str
    grupo: str
    regime_h: int = 16  # 8, 16, 24 (0 = infinite/external)
    e_externo: bool = False
    setup_h: float = 1.0


@dataclass(slots=True)
class Dependencia:
    """A precedence dependency between operations."""
    predecessor_id: int
    sucessor_id: int
    tipo: str = "FS"
    lag: int = 0


@dataclass
class MolditEngineData:
    """Complete input data for the Moldit scheduler."""
    operacoes: list[Operacao] = field(default_factory=list)
    maquinas: list[Maquina] = field(default_factory=list)
    moldes: list[Molde] = field(default_factory=list)
    dependencias: list[Dependencia] = field(default_factory=list)
    compatibilidade: dict[str, list[str]] = field(default_factory=dict)
    dag: dict[int, list[int]] = field(default_factory=dict)
    dag_reverso: dict[int, list[int]] = field(default_factory=dict)
    caminho_critico: list[int] = field(default_factory=list)
    feriados: list[str] = field(default_factory=list)
    data_referencia: str = ""
