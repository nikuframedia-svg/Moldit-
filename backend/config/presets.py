"""Policy presets — Moldit Planner.

Named config profiles for common scheduling scenarios.
4 presets with Moldit scoring weights.
"""

from __future__ import annotations

import copy

from backend.config.types import FactoryConfig

PRESETS: dict[str, dict] = {
    "rapido": {
        "weight_deadline_compliance": 0.60,
        "weight_makespan": 0.25,
        "weight_setups": 0.05,
        "weight_balance": 0.10,
    },
    "equilibrado": {
        "weight_deadline_compliance": 0.35,
        "weight_makespan": 0.35,
        "weight_setups": 0.15,
        "weight_balance": 0.15,
    },
    "min_setups": {
        "weight_setups": 0.50,
        "weight_makespan": 0.20,
        "weight_deadline_compliance": 0.20,
        "weight_balance": 0.10,
    },
    "balanceado": {
        "weight_balance": 0.45,
        "weight_makespan": 0.25,
        "weight_deadline_compliance": 0.20,
        "weight_setups": 0.10,
    },
}


def list_presets() -> list[str]:
    """Return available preset names."""
    return list(PRESETS.keys())


def get_preset(name: str) -> dict:
    """Return override dict for a preset. Raises KeyError if unknown."""
    if name not in PRESETS:
        raise KeyError(f"Preset desconhecido: {name!r}. Disponiveis: {list_presets()}")
    return PRESETS[name].copy()


def apply_preset(config: FactoryConfig, name: str) -> FactoryConfig:
    """Return a copy of config with preset overrides applied."""
    overrides = get_preset(name)
    result = copy.copy(config)
    for key, value in overrides.items():
        if not hasattr(result, key):
            raise KeyError(f"FactoryConfig nao tem atributo {key!r}")
        setattr(result, key, value)
    return result
