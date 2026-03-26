"""CPO v3.0 — Cascading Pipeline Optimizer (Standalone Test).

Evolutionary optimizer wrapping the existing greedy scheduler.
NOT integrated into production. Test/prototype only.
"""

from scripts.cpo.optimizer import optimize

__all__ = ["optimize"]
