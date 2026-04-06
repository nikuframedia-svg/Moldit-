"""M4 — Machine Recommender (Statistical Aggregation).

Ranks machines by historical performance for each operation type.
Starts with simple statistics; can evolve to LightGBM with 50+ molds.
"""
from __future__ import annotations

import logging
from collections import defaultdict

import numpy as np

from backend.ml.data_model import MachineScore, TrainMetrics

logger = logging.getLogger(__name__)


class MachineRecommender:
    """M4: Ranks machines by performance per operation type."""

    def __init__(self) -> None:
        self._scores: dict[tuple[str, str], MachineScore] = {}
        self.is_trained = False
        self.version = "0"
        self.n_samples = 0

    def train(self, ops: list[dict]) -> TrainMetrics:
        """Train from historical operations.

        Each op dict needs: tipo_operacao (or codigo), maquina_real,
        ratio_work, motivo_desvio.
        """
        if len(ops) < 5:
            logger.warning("M4: Not enough data (%d ops), skipping", len(ops))
            return TrainMetrics(model_name="M4_machine", n_samples=len(ops))

        # Group by (tipo_operacao, maquina_real)
        groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
        for op in ops:
            tipo = op.get("tipo_operacao", op.get("codigo", ""))
            maq = op.get("maquina_real", op.get("maquina_id", ""))
            if tipo and maq:
                groups[(tipo, maq)].append(op)

        self._scores.clear()
        n_valid = 0

        for (tipo, maq), group_ops in groups.items():
            ratios = []
            n_problemas = 0
            for op in group_ops:
                r = op.get("ratio_work", 0)
                if 0.1 < r < 10.0:
                    ratios.append(r)
                if op.get("motivo_desvio", ""):
                    n_problemas += 1

            if len(ratios) < 3:
                continue

            arr = np.array(ratios)
            self._scores[(tipo, maq)] = MachineScore(
                maquina=maq,
                n_amostras=len(ratios),
                ratio_medio=round(float(arr.mean()), 4),
                ratio_std=round(float(arr.std()), 4),
                percentil_95=round(float(np.percentile(arr, 95)), 4),
                taxa_problemas=round(n_problemas / len(group_ops), 4),
            )
            n_valid += 1

        self.is_trained = True
        self.n_samples = len(ops)
        self.version = str(self.n_samples)

        logger.info("M4 trained: %d ops → %d (tipo, maquina) pairs", len(ops), n_valid)

        return TrainMetrics(
            model_name="M4_machine",
            n_samples=len(ops),
            n_features=n_valid,
        )

    def score(self, tipo_operacao: str, maquina_id: str) -> MachineScore | None:
        """Get score for a specific (tipo, maquina) pair."""
        return self._scores.get((tipo_operacao, maquina_id))

    def ranking(self, tipo_operacao: str) -> list[MachineScore]:
        """Rank all machines for an operation type (best first)."""
        results = []
        for (tipo, maq), sc in self._scores.items():
            if tipo == tipo_operacao:
                results.append(sc)
        return sorted(results, key=lambda s: s.ratio_medio)

    def get_all_tipos(self) -> list[str]:
        """All operation types with scores."""
        return sorted(set(t for t, _ in self._scores.keys()))

    def get_matrix(self) -> dict[str, list[MachineScore]]:
        """Full ranking matrix: {tipo: [MachineScore sorted]}."""
        result: dict[str, list[MachineScore]] = {}
        for tipo in self.get_all_tipos():
            result[tipo] = self.ranking(tipo)
        return result

    def get_recommendation(self, tipo_operacao: str) -> str:
        """Human-readable recommendation for a type."""
        ranked = self.ranking(tipo_operacao)
        if len(ranked) < 2:
            return ""
        best = ranked[0]
        worst = ranked[-1]
        diff = worst.ratio_medio - best.ratio_medio
        if diff < 0.05:
            return f"Todas as maquinas tem performance semelhante para {tipo_operacao}."
        return (
            f"Para {tipo_operacao}, preferir {best.maquina} "
            f"(ratio {best.ratio_medio:.2f}) em vez de {worst.maquina} "
            f"(ratio {worst.ratio_medio:.2f}) — "
            f"poupanca media: {diff * 8:.1f}h por operacao de 8h."
        )
