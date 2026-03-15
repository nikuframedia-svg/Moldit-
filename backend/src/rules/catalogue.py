"""Closed catalogue of available conditions and actions for the rules engine."""

from __future__ import annotations

from src.rules.models import Action, Condition

# ---------------------------------------------------------------------------
# Condition catalogue
# ---------------------------------------------------------------------------

CONDITION_CATALOGUE: dict[str, dict] = {
    "coverage_days_gt": {
        "name": "Cobertura > X dias",
        "description": "Stock covers more than X days of demand",
        "params": {"days": int},
    },
    "coverage_days_lt": {
        "name": "Cobertura < X dias",
        "description": "Stock covers less than X days of demand",
        "params": {"days": int},
    },
    "stock_gt": {
        "name": "Stock > X",
        "description": "Current stock above X pieces",
        "params": {"qty": int},
    },
    "stock_eq_zero": {
        "name": "Stock = 0",
        "description": "No stock available",
        "params": {},
    },
    "has_atraso": {
        "name": "Tem atraso",
        "description": "Already failed delivery deadline",
        "params": {},
    },
    "qty_lt_lot": {
        "name": "Qty < Lote economico",
        "description": "Order quantity smaller than economic lot",
        "params": {},
    },
    "machine_load_gt": {
        "name": "Carga maquina > X%",
        "description": "Machine load exceeds threshold",
        "params": {"pct": int},
    },
    "same_material_as": {
        "name": "Partilha material com",
        "description": "References that share the same raw material",
        "params": {"refs": list},
    },
    "is_twin": {
        "name": "E peca gemea",
        "description": "Reference has a twin_ref (co-production)",
        "params": {},
    },
    "client_is": {
        "name": "Cliente = X",
        "description": "Filter by client name",
        "params": {"client": str},
    },
    "days_to_deadline_lt": {
        "name": "Dias ate entrega < X",
        "description": "Delivery deadline is less than X days away",
        "params": {"days": int},
    },
    "tool_is": {
        "name": "Ferramenta = X",
        "description": "Filter by tool ID",
        "params": {"tool": str},
    },
}

# ---------------------------------------------------------------------------
# Action catalogue
# ---------------------------------------------------------------------------

ACTION_CATALOGUE: dict[str, dict] = {
    "skip_scheduling": {
        "name": "Nao agendar",
        "description": "Skip this reference in scheduling",
        "params": {},
    },
    "priority_boost": {
        "name": "Aumentar prioridade",
        "description": "Move reference up in the scheduling queue",
        "params": {"boost": int},
    },
    "force_machine": {
        "name": "Forcar maquina",
        "description": "Override machine assignment",
        "params": {"machine": str},
    },
    "group_with": {
        "name": "Agrupar com",
        "description": "Group references on same machine (material affinity)",
        "params": {"machine": str},
    },
    "set_min_lot": {
        "name": "Lote minimo",
        "description": "Override minimum lot size",
        "params": {"qty": int},
    },
    "alert_red": {
        "name": "Alerta vermelho",
        "description": "Force a red alert for this reference",
        "params": {"msg": str},
    },
    "alert_yellow": {
        "name": "Alerta amarelo",
        "description": "Force a yellow alert for this reference",
        "params": {"msg": str},
    },
    "suppress_alert": {
        "name": "Suprimir alerta",
        "description": "Hide alert for this reference",
        "params": {},
    },
    "use_alternative": {
        "name": "Usar alternativa",
        "description": "Use alternative machine if available",
        "params": {},
    },
    "set_buffer_days": {
        "name": "Buffer de producao",
        "description": "Override JIT buffer days for this reference",
        "params": {"days": int},
    },
}


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------


def validate_condition(condition: Condition) -> bool:
    """Validate that a condition type exists in the catalogue and params match."""
    entry = CONDITION_CATALOGUE.get(condition.type)
    if entry is None:
        raise ValueError(f"Unknown condition type: {condition.type!r}")
    expected = entry["params"]
    for key, typ in expected.items():
        if key not in condition.params:
            raise ValueError(f"Missing param {key!r} for condition {condition.type!r}")
        if not isinstance(condition.params[key], typ):
            raise TypeError(f"Param {key!r} must be {typ.__name__}, got {type(condition.params[key]).__name__}")
    return True


def validate_action(action: Action) -> bool:
    """Validate that an action type exists in the catalogue and params match."""
    entry = ACTION_CATALOGUE.get(action.type)
    if entry is None:
        raise ValueError(f"Unknown action type: {action.type!r}")
    expected = entry["params"]
    for key, typ in expected.items():
        if key not in action.params:
            raise ValueError(f"Missing param {key!r} for action {action.type!r}")
        if not isinstance(action.params[key], typ):
            raise TypeError(f"Param {key!r} must be {typ.__name__}, got {type(action.params[key]).__name__}")
    return True
