"""SHAP Explainability — Moldit ML.

Generates human-readable explanations for ML predictions
using SHAP (SHapley Additive exPlanations) values.
"""
from __future__ import annotations

import logging

from backend.ml.data_model import ShapContribution
from backend.ml.feature_engineering import FEATURE_NAMES_OP, extrair_features_operacao

logger = logging.getLogger(__name__)

# Portuguese descriptions for each feature
_FEATURE_DESCRIPTIONS_PT = {
    "tipo_operacao_hash": "Tipo de operacao",
    "work_h_estimado": "Duracao estimada no .mpp",
    "setup_h_estimado": "Tempo de setup estimado",
    "maquina_hash": "Maquina atribuida",
    "complexidade": "Complexidade do molde",
    "n_cavidades": "Numero de cavidades",
    "peso_kg": "Peso estimado do molde",
    "posicao_dag": "Posicao na arvore de dependencias",
    "n_predecessores": "Numero de operacoes predecessoras",
    "stress_maquina": "Nivel de stress da maquina",
    "ratio_historico_tipo": "Ratio historico deste tipo de operacao",
    "ratio_historico_maquina": "Ratio historico desta maquina",
}


class ShapExplainer:
    """Generates SHAP explanations for ML predictions."""

    def __init__(self) -> None:
        self._explainer = None
        self._is_ready = False

    def initialize(self, model) -> None:
        """Initialize SHAP TreeExplainer for a model."""
        try:
            import shap
            self._explainer = shap.TreeExplainer(model)
            self._is_ready = True
        except ImportError:
            logger.warning("shap package not installed — explanations unavailable")
        except Exception as e:
            logger.warning("SHAP init failed: %s", e)

    def explain_duration(
        self,
        model,
        op: dict,
        top_k: int = 5,
        **feat_kwargs,
    ) -> list[ShapContribution]:
        """Explain a duration prediction with top-k SHAP contributions.

        Args:
            model: The trained XGBoost model (median).
            op: Operation dict with feature fields.
            top_k: Number of top contributions to return.
        """
        if not self._is_ready:
            return self._fallback_explain(op, **feat_kwargs)

        try:
            X = extrair_features_operacao(op, **feat_kwargs).reshape(1, -1)
            shap_values = self._explainer.shap_values(X)

            if isinstance(shap_values, list):
                shap_values = shap_values[0]

            values = shap_values.flatten()
            contributions = []

            for i, (name, val) in enumerate(zip(FEATURE_NAMES_OP, values)):
                if i >= len(values):
                    break
                desc = _FEATURE_DESCRIPTIONS_PT.get(name, name)

                # Make description more specific
                if abs(val) > 0.01:
                    if val > 0:
                        desc_full = f"{desc} (+{val:.1f}h)"
                    else:
                        desc_full = f"{desc} ({val:.1f}h)"

                    contributions.append(ShapContribution(
                        feature=name,
                        contribuicao_h=round(float(val), 2),
                        descricao=desc_full,
                    ))

            # Sort by absolute contribution, return top-k
            contributions.sort(key=lambda c: abs(c.contribuicao_h), reverse=True)
            return contributions[:top_k]

        except Exception as e:
            logger.warning("SHAP explain failed: %s", e)
            return self._fallback_explain(op, **feat_kwargs)

    def _fallback_explain(self, op: dict, **feat_kwargs) -> list[ShapContribution]:
        """Simple heuristic explanation when SHAP is unavailable."""
        contributions = []
        calibration = feat_kwargs.get("calibration", {})
        codigo = op.get("codigo", op.get("tipo_operacao", ""))

        if calibration and codigo in calibration:
            ratio = calibration[codigo]
            if abs(ratio - 1.0) > 0.05:
                work_h = op.get("work_h_estimado", op.get("work_h", 0))
                delta = work_h * (ratio - 1.0)
                contributions.append(ShapContribution(
                    feature="ratio_historico_tipo",
                    contribuicao_h=round(delta, 2),
                    descricao=(
                        f"Operacoes tipo '{codigo}' demoram "
                        f"historicamente {ratio:.0%}x o estimado"
                    ),
                ))

        return contributions
