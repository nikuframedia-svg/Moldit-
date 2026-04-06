"""Cold Start Manager — Moldit ML.

Progressive behavior based on number of completed molds.
The system starts with no ML and gradually enables features
as historical data accumulates.
"""
from __future__ import annotations

from enum import Enum


class ColdStartPhase(Enum):
    ZERO = "zero"       # 0 molds — ML off, uses .mpp only
    COLD = "cold"       # 1-5 molds — simple averages, very low confidence
    WARM = "warm"       # 5-20 molds — M1+M4 active, low-medium confidence
    STABLE = "stable"   # 20-50 molds — all models, medium-high confidence
    MATURE = "mature"   # 50+ molds — high confidence, all features active


PHASE_CONFIG = {
    ColdStartPhase.ZERO: {
        "label": "Sem dados historicos",
        "models_active": [],
        "min_confianca": 1.0,  # effectively disables ML
        "message": "Sistema sem dados historicos. A usar estimativas do .mpp.",
    },
    ColdStartPhase.COLD: {
        "label": "Arranque frio",
        "models_active": ["M4_machine"],
        "min_confianca": 0.8,
        "message": "Poucos dados ({n} moldes). Medias simples activas. Confianca muito baixa.",
    },
    ColdStartPhase.WARM: {
        "label": "Aquecimento",
        "models_active": ["M1_duration", "M3_analogy", "M4_machine"],
        "min_confianca": 0.5,
        "message": "Dados em crescimento ({n} moldes). Previsoes de duracao e analogia activas.",
    },
    ColdStartPhase.STABLE: {
        "label": "Estavel",
        "models_active": ["M1_duration", "M2_risk", "M3_analogy", "M4_machine", "M5_anomaly"],
        "min_confianca": 0.3,
        "message": "Dados suficientes ({n} moldes). Todos os modelos activos.",
    },
    ColdStartPhase.MATURE: {
        "label": "Maduro",
        "models_active": ["M1_duration", "M2_risk", "M3_analogy", "M4_machine", "M5_anomaly"],
        "min_confianca": 0.2,
        "message": "Sistema maduro ({n} moldes). Alta confianca em todas as previsoes.",
    },
}


class ColdStartManager:
    """Manages ML feature availability based on data volume."""

    def get_phase(self, n_projetos: int) -> ColdStartPhase:
        if n_projetos == 0:
            return ColdStartPhase.ZERO
        if n_projetos <= 5:
            return ColdStartPhase.COLD
        if n_projetos <= 20:
            return ColdStartPhase.WARM
        if n_projetos <= 50:
            return ColdStartPhase.STABLE
        return ColdStartPhase.MATURE

    def should_use_ml(self, model_name: str, n_projetos: int) -> bool:
        """Check if a specific model should be active."""
        phase = self.get_phase(n_projetos)
        config = PHASE_CONFIG[phase]
        return model_name in config["models_active"]

    def get_min_confianca(self, n_projetos: int) -> float:
        phase = self.get_phase(n_projetos)
        return PHASE_CONFIG[phase]["min_confianca"]

    def get_status_message(self, n_projetos: int) -> str:
        phase = self.get_phase(n_projetos)
        config = PHASE_CONFIG[phase]
        return config["message"].format(n=n_projetos)

    def get_phase_info(self, n_projetos: int) -> dict:
        """Full phase info for the status endpoint."""
        phase = self.get_phase(n_projetos)
        config = PHASE_CONFIG[phase]
        return {
            "phase": phase.value,
            "phase_label": config["label"],
            "models_active": config["models_active"],
            "min_confianca": config["min_confianca"],
            "message": config["message"].format(n=n_projetos),
            "n_projetos": n_projetos,
        }

    def get_confidence_label(self, n_samples: int) -> str:
        """Human-readable confidence based on sample count."""
        if n_samples < 5:
            return "muito_baixa"
        if n_samples < 20:
            return "baixa"
        if n_samples < 50:
            return "media"
        if n_samples < 100:
            return "alta"
        return "muito_alta"
