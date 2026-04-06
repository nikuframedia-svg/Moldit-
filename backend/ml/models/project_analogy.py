"""M3 — Project Analogy (kNN + Cosine Similarity).

Finds historical molds most similar to the current one.
Similarity weights learn from user feedback.
"""
from __future__ import annotations

import logging

import numpy as np

from backend.ml.data_model import AnalogoResult
from backend.ml.feature_engineering import cosine_similarity, vetor_molde_normalizado

logger = logging.getLogger(__name__)


class ProjectAnalogy:
    """M3: Finds analogous past projects."""

    def __init__(self) -> None:
        self.historico: list[dict] = []
        self.vetores: np.ndarray = np.empty((0, 0))
        self.pesos: np.ndarray | None = None  # learnable similarity weights
        self.is_trained = False
        self.version = "0"

    def train(
        self,
        projetos: list[dict],
        ops_by_projeto: dict[str, list[dict]] | None = None,
    ) -> None:
        """Index historical projects for similarity search.

        Args:
            projetos: List of ProjetoHistorico dicts.
            ops_by_projeto: {projeto_id: [op dicts]} for type distribution.
        """
        if not projetos:
            return

        ops_by_proj = ops_by_projeto or {}
        vecs = []
        for p in projetos:
            pid = p.get("projeto_id", "")
            ops = ops_by_proj.get(pid, [])
            vecs.append(vetor_molde_normalizado(p, ops))

        self.historico = list(projetos)
        self.vetores = np.vstack(vecs)

        # Initialise uniform weights if not yet learned
        if self.pesos is None or len(self.pesos) != self.vetores.shape[1]:
            self.pesos = np.ones(self.vetores.shape[1], dtype=np.float64)

        self.is_trained = True
        self.version = str(len(projetos))
        logger.info("M3 indexed: %d projects, %d features", len(projetos), self.vetores.shape[1])

    def encontrar_analogos(
        self,
        projeto_novo: dict,
        ops_novo: list[dict] | None = None,
        top_k: int = 5,
    ) -> list[AnalogoResult]:
        """Find top-k most similar past projects."""
        if not self.is_trained or len(self.historico) == 0:
            return []

        v_novo = vetor_molde_normalizado(projeto_novo, ops_novo)
        pesos = self.pesos if self.pesos is not None else np.ones(len(v_novo))

        # Weighted vectors
        v_novo_w = v_novo * pesos

        scores = []
        for i, p in enumerate(self.historico):
            v_hist_w = self.vetores[i] * pesos
            sim = cosine_similarity(v_novo_w, v_hist_w)
            scores.append((i, sim))

        scores.sort(key=lambda x: -x[1])
        results = []
        for idx, sim in scores[:top_k]:
            p = self.historico[idx]
            compliance = bool(p.get("compliance", True))

            # Generate note about what happened
            delay = p.get("makespan_real_dias", 0) - p.get("makespan_planeado_dias", 0)
            if compliance:
                nota = f"Concluido dentro do prazo ({p.get('makespan_real_dias', '?')} dias)."
            else:
                real = p.get('makespan_real_dias', '?')
                plano = p.get('makespan_planeado_dias', '?')
                nota = f"Atrasou {delay} dias (real: {real} vs plano: {plano})."

            results.append(AnalogoResult(
                projeto_id=p.get("projeto_id", ""),
                molde_id=p.get("molde_id", ""),
                similaridade=round(sim, 3),
                n_ops=p.get("n_operacoes", 0),
                makespan_real_dias=p.get("makespan_real_dias", 0),
                compliance=compliance,
                nota=nota,
            ))

        return results

    def feedback(self, molde_id: str, analogo_id: str, util: bool) -> None:
        """Adjust similarity weights based on user feedback.

        If the analogy was useful, increase weights for features where
        the two molds are similar. If not useful, decrease.
        """
        if self.pesos is None or not self.is_trained:
            return

        # Find the analogue in history
        idx = None
        for i, p in enumerate(self.historico):
            if p.get("projeto_id") == analogo_id or p.get("molde_id") == analogo_id:
                idx = i
                break
        if idx is None:
            return

        # Weight update: simple gradient-free approach
        # Features where values are close get boosted if feedback is positive
        v_hist = self.vetores[idx]
        # Use the mean of all vectors as "typical" project
        v_mean = self.vetores.mean(axis=0)
        diff = np.abs(v_hist - v_mean)

        lr = 0.05
        if util:
            # Useful analogy → boost features where this analogue stands out
            self.pesos += lr * (1.0 - diff)  # similar features get weight boost
        else:
            # Not useful → reduce weight on features that looked similar
            self.pesos -= lr * (1.0 - diff)

        # Clamp weights to [0.1, 5.0]
        self.pesos = np.clip(self.pesos, 0.1, 5.0)
        label = "util" if util else "nao_util"
        logger.info(
            "M3 feedback: %s for %s→%s, weights updated",
            label, molde_id, analogo_id,
        )
