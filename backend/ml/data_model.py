"""ML Data Model — Moldit Planner.

Dataclasses for historical project and operation records.
Each completed mold generates a ProjetoHistorico with all its operations.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass
class OperacaoHistorica:
    """A completed operation with actual vs planned data."""

    op_id: int
    tipo_operacao: str          # e.g. 'fresagem_cavidade', 'erosao_fio'
    molde_id: str
    projeto_id: str

    # Machine
    maquina_planeada: str
    maquina_real: str           # may differ if reassigned

    # Durations
    work_h_estimado: float      # what the .mpp said
    work_h_real: float          # what actually happened
    setup_h_estimado: float
    setup_h_real: float
    ratio_work: float           # real / estimado
    ratio_setup: float

    # Timing
    dia_planeado: int
    dia_real: int
    inicio_planeado_h: float = 0.0
    inicio_real_h: float = 0.0
    atraso_h: float = 0.0      # real - planeado (negative = early)

    # Context
    n_predecessores: int = 0
    posicao_no_dag: int = 0     # depth in dependency tree
    stress_maquina_no_dia: float = 0.0
    operador: str = ""
    turno: str = ""             # manha / tarde / noite
    motivo_desvio: str = ""


@dataclass
class ProjetoHistorico:
    """A completed mold project archived for ML training."""

    # Identity
    projeto_id: str             # e.g. 'PRJ-2026-042'
    molde_id: str               # e.g. 'Molde-2954'
    cliente: str
    data_inicio: date
    data_conclusao: date
    data_deadline: date

    # Mold characteristics (ML features)
    n_operacoes: int
    n_maquinas_usadas: int
    work_total_h: float
    n_dependencias: int
    profundidade_dag: int       # longest path in DAG
    n_tipos_operacao: int
    complexidade: str           # 'baixa' | 'media' | 'alta' | 'muito_alta'
    tipo_molde: str = "injecao_plastico"
    peso_estimado_kg: float = 0.0
    n_cavidades: int = 1

    # Actual results
    makespan_planeado_dias: int = 0
    makespan_real_dias: int = 0
    compliance: bool = True     # met deadline?
    score_final: float = 0.0

    # Detailed operations
    operacoes: list[OperacaoHistorica] = field(default_factory=list)


@dataclass
class DurationPrediction:
    """Output of M1 — Duration Predictor."""

    op_id: int
    estimado_mpp: float
    previsao_ml: float
    intervalo_p10: float
    intervalo_p90: float
    ratio: float                # previsao_ml / estimado_mpp
    confianca: float            # 0.0–1.0
    explicacao: list[ShapContribution] = field(default_factory=list)


@dataclass
class ShapContribution:
    """One SHAP feature contribution to a prediction."""

    feature: str                # e.g. 'tipo_operacao=fresagem'
    contribuicao_h: float       # hours added/removed
    descricao: str              # PT description for UI


@dataclass
class RiskPrediction:
    """Output of M2 — Risk Predictor."""

    molde_id: str
    prob_atraso: float          # 0.0–1.0
    dias_atraso_esperado: int
    top_fatores_risco: list[str]
    molde_analogo_que_atrasou: str = ""
    recomendacao: str = ""


@dataclass
class AnalogoResult:
    """Output of M3 — Project Analogy."""

    projeto_id: str
    molde_id: str
    similaridade: float         # 0.0–1.0
    n_ops: int
    makespan_real_dias: int
    compliance: bool
    nota: str                   # what went well/wrong


@dataclass
class MachineScore:
    """Output of M4 — Machine Recommender."""

    maquina: str
    n_amostras: int
    ratio_medio: float          # mean(actual/planned)
    ratio_std: float
    percentil_95: float = 0.0
    taxa_problemas: float = 0.0  # fraction with motivo_desvio


@dataclass
class AnomalyResult:
    """Output of M5 — Anomaly Detector."""

    op_id: int
    tipo: str                   # 'duracao_excessiva', 'setup_excessivo', 'maquina_lenta', etc.
    projecao_h: float           # projected total duration
    esperado_h: float           # expected duration
    desvio_pct: float           # (projecao - esperado) / esperado
    acao_sugerida: str
    timestamp: str = ""


@dataclass
class PatternAlert:
    """Machine-level pattern from M5."""

    maquina_id: str
    tipo: str                   # 'maquina_lenta', 'padrao_turno'
    descricao: str
    n_ocorrencias: int
    acao_sugerida: str


@dataclass
class TrainMetrics:
    """Metrics from a single model training run."""

    model_name: str
    mae: float = 0.0
    rmse: float = 0.0
    coverage: float = 0.0      # P10-P90 coverage
    auc_roc: float = 0.0
    f1: float = 0.0
    ndcg: float = 0.0
    n_samples: int = 0
    n_features: int = 0


@dataclass
class TrainReport:
    """Complete report from training all models."""

    status: str                 # 'ok' | 'partial' | 'failed'
    models_trained: list[str] = field(default_factory=list)
    duration_s: float = 0.0
    metrics: dict[str, TrainMetrics] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


@dataclass
class EvolutionPoint:
    """A single point in the model evolution timeline."""

    date: str
    mae: float
    coverage: float
    n_samples: int


@dataclass
class MLModelInfo:
    """Status of one ML model."""

    name: str
    version: str
    health: str                 # 'saudavel' | 'degradado' | 'inativo'
    last_train: str
    metrics: dict[str, float] = field(default_factory=dict)
    n_samples: int = 0


@dataclass
class MLStatus:
    """Overall ML system status."""

    phase: str                  # 'zero' | 'cold' | 'warm' | 'stable' | 'mature'
    phase_label: str
    n_projetos: int
    models: list[MLModelInfo] = field(default_factory=list)
    last_retrain: str = ""
