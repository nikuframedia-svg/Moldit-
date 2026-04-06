"""Feature Engineering — Moldit ML.

Extract features from operations, molds, and factory context
for training and prediction across all 5 ML models.
"""
from __future__ import annotations

import hashlib
from collections import Counter

import numpy as np

# ── Constants ────────────────────────────────────────────────────────

COMPLEXIDADE_MAP = {"baixa": 0.25, "media": 0.50, "alta": 0.75, "muito_alta": 1.0}

TIPO_MOLDE_MAP = {
    "injecao_plastico": 0,
    "injecao_aluminio": 1,
    "injecao_zamak": 2,
    "sopro": 3,
    "compressao": 4,
}

# Canonical operation types for distribution vector
CANONICAL_TIPOS = [
    "fresagem", "erosao", "furacao", "retificacao",
    "polimento", "montagem", "bancada", "torneamento",
    "tapagem", "controlo", "externo", "outro",
]

FEATURE_NAMES_OP = [
    "tipo_operacao_hash", "work_h_estimado", "setup_h_estimado",
    "maquina_hash", "complexidade", "n_cavidades", "peso_kg",
    "posicao_dag", "n_predecessores", "stress_maquina",
    "ratio_historico_tipo", "ratio_historico_maquina",
]

FEATURE_NAMES_MOLDE = [
    "n_operacoes", "work_total_h", "profundidade_dag",
    "n_dependencias", "n_maquinas", "n_tipos_operacao",
    "complexidade", "peso_kg", "n_cavidades",
    "folga_deadline_dias",
    *[f"pct_{t}" for t in CANONICAL_TIPOS],
]


def _hash_category(value: str, n_buckets: int = 64) -> float:
    """Hash a categorical string to a float in [0, 1]."""
    h = int(hashlib.md5(value.encode()).hexdigest()[:8], 16)
    return (h % n_buckets) / n_buckets


def _classify_tipo(codigo: str) -> str:
    """Map an operation code to a canonical type."""
    code_lower = codigo.lower()
    for t in CANONICAL_TIPOS[:-1]:  # skip 'outro'
        if t[:4] in code_lower:
            return t
    return "outro"


# ── Operation features (for M1, M5) ─────────────────────────────────

def extrair_features_operacao(
    op: dict,
    *,
    complexidade: str = "media",
    n_cavidades: int = 1,
    peso_kg: float = 0.0,
    calibration: dict[str, float] | None = None,
    machine_ratios: dict[str, float] | None = None,
) -> np.ndarray:
    """Extract feature vector for one operation.

    Args:
        op: Dict with keys: codigo, work_h_estimado (or work_h), setup_h_estimado,
            maquina_real (or maquina_id), posicao_no_dag, n_predecessores,
            stress_maquina_no_dia.
        complexidade: Mold complexity string.
        n_cavidades: Number of mold cavities.
        peso_kg: Estimated mold weight.
        calibration: {codigo: ratio_media} from CalibrationFactor.
        machine_ratios: {maquina_id: ratio_media} from M4.

    Returns:
        numpy array of shape (12,).
    """
    codigo = op.get("codigo", op.get("tipo_operacao", ""))
    maquina = op.get("maquina_real", op.get("maquina_id", op.get("maquina_planeada", "")))
    work_h = op.get("work_h_estimado", op.get("work_h", 0.0))
    setup_h = op.get("setup_h_estimado", op.get("setup_h", 0.0))

    ratio_tipo = 1.0
    if calibration and codigo in calibration:
        ratio_tipo = calibration[codigo]

    ratio_maq = 1.0
    if machine_ratios and maquina in machine_ratios:
        ratio_maq = machine_ratios[maquina]

    return np.array([
        _hash_category(codigo),
        work_h,
        setup_h,
        _hash_category(maquina),
        COMPLEXIDADE_MAP.get(complexidade, 0.5),
        n_cavidades,
        peso_kg / 5000.0,  # normalise
        op.get("posicao_no_dag", op.get("posicao_dag", 0)),
        op.get("n_predecessores", 0),
        op.get("stress_maquina_no_dia", op.get("stress_maquina", 0.0)),
        ratio_tipo,
        ratio_maq,
    ], dtype=np.float64)


def extrair_features_operacao_df(
    ops: list[dict],
    **kwargs,
) -> np.ndarray:
    """Extract features for a batch of operations. Returns (N, 12) array."""
    if not ops:
        return np.empty((0, len(FEATURE_NAMES_OP)), dtype=np.float64)
    return np.vstack([extrair_features_operacao(op, **kwargs) for op in ops])


# ── Mold features (for M2, M3) ──────────────────────────────────────

def extrair_features_molde(
    projeto: dict,
    ops: list[dict] | None = None,
) -> np.ndarray:
    """Extract feature vector for one mold/project.

    Args:
        projeto: Dict with ProjetoHistorico fields.
        ops: Optional list of operation dicts (to compute type distribution).

    Returns:
        numpy array of shape (10 + len(CANONICAL_TIPOS),).
    """
    dist = _distribuicao_tipos(ops) if ops else np.zeros(len(CANONICAL_TIPOS))

    return np.concatenate([
        np.array([
            projeto.get("n_operacoes", 0),
            projeto.get("work_total_h", 0),
            projeto.get("profundidade_dag", 0),
            projeto.get("n_dependencias", 0),
            projeto.get("n_maquinas_usadas", projeto.get("n_maquinas", 0)),
            projeto.get("n_tipos_operacao", 0),
            COMPLEXIDADE_MAP.get(projeto.get("complexidade", "media"), 0.5),
            projeto.get("peso_estimado_kg", 0) / 5000.0,
            projeto.get("n_cavidades", 1),
            projeto.get("folga_deadline_dias", 0),
        ], dtype=np.float64),
        dist,
    ])


def vetor_molde_normalizado(
    projeto: dict,
    ops: list[dict] | None = None,
) -> np.ndarray:
    """Normalised mold vector for cosine similarity (M3).

    All values scaled to roughly [0, 1].
    """
    dist = _distribuicao_tipos(ops) if ops else np.zeros(len(CANONICAL_TIPOS))

    vec = np.array([
        projeto.get("n_operacoes", 0) / 150.0,
        projeto.get("work_total_h", 0) / 10000.0,
        projeto.get("profundidade_dag", 0) / 20.0,
        projeto.get("n_dependencias", 0) / 500.0,
        projeto.get("n_tipos_operacao", 0) / 15.0,
        COMPLEXIDADE_MAP.get(projeto.get("complexidade", "media"), 0.5),
        TIPO_MOLDE_MAP.get(projeto.get("tipo_molde", "injecao_plastico"), 0) / 4.0,
        projeto.get("peso_estimado_kg", 0) / 5000.0,
        projeto.get("n_cavidades", 1) / 8.0,
    ], dtype=np.float64)

    return np.concatenate([vec, dist])


# ── Helpers ──────────────────────────────────────────────────────────

def _distribuicao_tipos(ops: list[dict]) -> np.ndarray:
    """Compute operation type distribution vector (sums to ~1.0)."""
    if not ops:
        return np.zeros(len(CANONICAL_TIPOS), dtype=np.float64)

    counts: Counter[str] = Counter()
    for op in ops:
        codigo = op.get("codigo", op.get("tipo_operacao", ""))
        tipo = _classify_tipo(codigo)
        counts[tipo] += 1

    total = sum(counts.values()) or 1
    return np.array(
        [counts.get(t, 0) / total for t in CANONICAL_TIPOS],
        dtype=np.float64,
    )


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Weighted cosine similarity between two vectors."""
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a < 1e-9 or norm_b < 1e-9:
        return 0.0
    return float(dot / (norm_a * norm_b))


def calcular_profundidade_dag(dag: dict[int, list[int]]) -> int:
    """Compute maximum depth of a DAG (longest path)."""
    if not dag:
        return 0

    memo: dict[int, int] = {}

    def _depth(node: int) -> int:
        if node in memo:
            return memo[node]
        succs = dag.get(node, [])
        if not succs:
            memo[node] = 0
            return 0
        d = 1 + max(_depth(s) for s in succs)
        memo[node] = d
        return d

    all_nodes = set(dag.keys())
    for succs in dag.values():
        all_nodes.update(succs)
    return max((_depth(n) for n in all_nodes), default=0)


def calcular_posicoes_dag(dag_reverso: dict[int, list[int]]) -> dict[int, int]:
    """Compute DAG position (depth from roots) for each node."""
    if not dag_reverso:
        return {}

    positions: dict[int, int] = {}

    def _pos(node: int) -> int:
        if node in positions:
            return positions[node]
        preds = dag_reverso.get(node, [])
        if not preds:
            positions[node] = 0
            return 0
        p = 1 + max(_pos(pred) for pred in preds)
        positions[node] = p
        return p

    all_nodes = set(dag_reverso.keys())
    for preds in dag_reverso.values():
        all_nodes.update(preds)
    for n in all_nodes:
        _pos(n)
    return positions


def inferir_complexidade(n_ops: int, work_total_h: float) -> str:
    """Infer mold complexity from operation count and total work."""
    if n_ops > 120 or work_total_h > 2000:
        return "muito_alta"
    if n_ops > 80 or work_total_h > 1200:
        return "alta"
    if n_ops > 40 or work_total_h > 600:
        return "media"
    return "baixa"
