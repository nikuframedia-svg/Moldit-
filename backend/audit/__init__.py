"""Audit Trail — Spec 07.

Each scheduler decision recorded with WHY.
Portuguese explanations. Zero hallucination.
"""

from .counterfactual import compute_counterfactual
from .diff import compute_diff
from .logger import AuditLogger
from .store import AuditStore
from .types import AuditTrail, CounterfactualResult, DecisionRecord, ScheduleDiff

__all__ = [
    "AuditLogger",
    "AuditStore",
    "AuditTrail",
    "CounterfactualResult",
    "DecisionRecord",
    "ScheduleDiff",
    "compute_counterfactual",
    "compute_diff",
]
