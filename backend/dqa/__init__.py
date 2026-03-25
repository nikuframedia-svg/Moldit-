"""DQA — Spec 12 (data quality assessment + trust index)."""

from backend.dqa.trust_index import DQADimension, TrustResult, compute_trust_index

__all__ = ["DQADimension", "TrustResult", "compute_trust_index"]
