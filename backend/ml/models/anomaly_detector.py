"""M5 — Anomaly Detector (Isolation Forest + Statistical Baselines).

Detects operations running abnormally in real-time,
and machine-level patterns (e.g., consistent slowdowns).
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime

import numpy as np

from backend.ml.data_model import AnomalyResult, PatternAlert, TrainMetrics

logger = logging.getLogger(__name__)


class AnomalyDetector:
    """M5: Detects anomalous operations and machine patterns."""

    def __init__(self) -> None:
        self.model = None
        # Baselines: (tipo, maquina) → (mean_ratio, std_ratio, p75, p90)
        self._baselines: dict[tuple[str, str], tuple[float, float, float, float]] = {}
        # Machine recent ratios for pattern detection
        self._machine_history: dict[str, list[float]] = defaultdict(list)
        self.is_trained = False
        self.version = "0"
        self.n_samples = 0

    def train(self, ops: list[dict]) -> TrainMetrics:
        """Train baselines from historical operations.

        Each op dict needs: tipo_operacao/codigo, maquina_real, ratio_work.
        """
        if len(ops) < 10:
            logger.warning("M5: Not enough data (%d ops), skipping", len(ops))
            return TrainMetrics(model_name="M5_anomaly", n_samples=len(ops))

        # Build statistical baselines per (tipo, maquina)
        groups: dict[tuple[str, str], list[float]] = defaultdict(list)
        for op in ops:
            tipo = op.get("tipo_operacao", op.get("codigo", ""))
            maq = op.get("maquina_real", op.get("maquina_id", ""))
            ratio = op.get("ratio_work", 0)
            if tipo and maq and 0.1 < ratio < 10.0:
                groups[(tipo, maq)].append(ratio)

        self._baselines.clear()
        for key, ratios in groups.items():
            if len(ratios) < 3:
                continue
            arr = np.array(ratios)
            self._baselines[key] = (
                float(arr.mean()),
                float(arr.std()),
                float(np.percentile(arr, 75)),
                float(np.percentile(arr, 90)),
            )

        # Train Isolation Forest for multivariate anomaly detection
        try:
            from sklearn.ensemble import IsolationForest

            from backend.ml.feature_engineering import extrair_features_operacao_df

            X = extrair_features_operacao_df(ops)
            if X.shape[0] >= 20:
                self.model = IsolationForest(
                    contamination=0.05, random_state=42, n_estimators=100,
                )
                self.model.fit(X)
        except Exception as e:
            logger.warning("M5: IsolationForest training failed: %s", e)

        # Build machine history for pattern detection
        self._machine_history.clear()
        for op in ops:
            maq = op.get("maquina_real", "")
            ratio = op.get("ratio_work", 0)
            if maq and 0.1 < ratio < 10.0:
                self._machine_history[maq].append(ratio)

        self.is_trained = True
        self.n_samples = len(ops)
        self.version = str(self.n_samples)

        logger.info("M5 trained: %d ops, %d baselines", len(ops), len(self._baselines))

        return TrainMetrics(
            model_name="M5_anomaly",
            n_samples=len(ops),
            n_features=len(self._baselines),
        )

    def check(
        self,
        op: dict,
        progresso_pct: float = 0.0,
        horas_decorridas: float = 0.0,
    ) -> AnomalyResult | None:
        """Check if an in-progress operation is anomalous.

        Args:
            op: Operation with tipo_operacao/codigo, maquina_real, work_h_estimado.
            progresso_pct: 0-100 completion percentage.
            horas_decorridas: Hours elapsed since start.

        Returns:
            AnomalyResult if anomalous, None if normal.
        """
        if not self.is_trained:
            return None

        tipo = op.get("tipo_operacao", op.get("codigo", ""))
        maq = op.get("maquina_real", op.get("maquina_id", ""))
        work_h = op.get("work_h_estimado", op.get("work_h", 0))

        if not tipo or not maq or work_h <= 0:
            return None

        baseline = self._baselines.get((tipo, maq))
        if not baseline:
            return None

        mean_ratio, std_ratio, p75, p90 = baseline

        # Project total duration from progress
        if progresso_pct > 5 and horas_decorridas > 0:
            projecao_h = horas_decorridas / (progresso_pct / 100.0)
        elif horas_decorridas > 0:
            # No progress reported, use elapsed as minimum
            projecao_h = horas_decorridas * 2  # pessimistic
        else:
            return None

        esperado_h = work_h * mean_ratio
        ratio_actual = projecao_h / work_h if work_h > 0 else 1.0

        # Check: duration excessive (projection > P90 baseline)
        if ratio_actual > p90:
            desvio = (projecao_h - esperado_h) / esperado_h if esperado_h > 0 else 0
            return AnomalyResult(
                op_id=op.get("op_id", op.get("id", 0)),
                tipo="duracao_excessiva",
                projecao_h=round(projecao_h, 1),
                esperado_h=round(esperado_h, 1),
                desvio_pct=round(desvio * 100, 1),
                acao_sugerida=self._sugerir_acao("duracao_excessiva", maq, desvio),
                timestamp=datetime.now().isoformat(),
            )

        # Check: early termination (much faster than P25)
        p25 = max(mean_ratio - 1.5 * std_ratio, 0.3)
        if progresso_pct >= 90 and ratio_actual < p25:
            desvio = (projecao_h - esperado_h) / esperado_h if esperado_h > 0 else 0
            return AnomalyResult(
                op_id=op.get("op_id", op.get("id", 0)),
                tipo="terminacao_precoce",
                projecao_h=round(projecao_h, 1),
                esperado_h=round(esperado_h, 1),
                desvio_pct=round(desvio * 100, 1),
                acao_sugerida="Oportunidade: antecipar operacao seguinte.",
                timestamp=datetime.now().isoformat(),
            )

        return None

    def check_setup_anomaly(
        self, op: dict, setup_h_real: float,
    ) -> AnomalyResult | None:
        """Check if setup time is anomalous."""
        setup_h_estimado = op.get("setup_h_estimado", op.get("setup_h", 0))
        if setup_h_estimado <= 0:
            return None

        ratio = setup_h_real / setup_h_estimado
        if ratio > 2.0:
            return AnomalyResult(
                op_id=op.get("op_id", op.get("id", 0)),
                tipo="setup_excessivo",
                projecao_h=round(setup_h_real, 1),
                esperado_h=round(setup_h_estimado, 1),
                desvio_pct=round((ratio - 1.0) * 100, 1),
                acao_sugerida="Verificar compatibilidade de fixacao. Registar causa.",
                timestamp=datetime.now().isoformat(),
            )
        return None

    def check_machine_pattern(
        self, maquina_id: str, ultimas_n: int = 5,
    ) -> list[PatternAlert]:
        """Detect machine-level patterns from recent operations."""
        alerts: list[PatternAlert] = []
        history = self._machine_history.get(maquina_id, [])

        if len(history) < ultimas_n:
            return alerts

        recent = history[-ultimas_n:]

        # Pattern: 3+ consecutive above P75
        # Get global P75 for this machine
        all_baselines_for_maq = [
            (mean, p75) for (t, m), (mean, std, p75, p90)
            in self._baselines.items() if m == maquina_id
        ]
        if all_baselines_for_maq:
            avg_p75 = np.mean([p75 for _, p75 in all_baselines_for_maq])
            above_p75 = sum(1 for r in recent if r > avg_p75)
            if above_p75 >= 3:
                alerts.append(PatternAlert(
                    maquina_id=maquina_id,
                    tipo="maquina_lenta",
                    descricao=(
                        f"{maquina_id} teve {above_p75}/{ultimas_n} operacoes "
                        f"acima do P75 — possivel degradacao de ferramenta."
                    ),
                    n_ocorrencias=above_p75,
                    acao_sugerida="Agendar manutencao preventiva.",
                ))

        return alerts

    def _sugerir_acao(self, tipo: str, maquina: str, desvio: float) -> str:
        if desvio > 0.5:
            return f"Verificar maquina {maquina} ou material. Considerar mover para outra maquina."
        if desvio > 0.3:
            return f"Operacao a correr {desvio:.0%} mais lenta. Monitorizar progresso."
        return "Ligeiro desvio. Continuar a monitorizar."
