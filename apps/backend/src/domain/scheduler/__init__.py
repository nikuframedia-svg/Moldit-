"""Greedy scheduler — port of scheduling-engine TS to Python.

Primary solver: ATCS-based greedy with 3-tier overflow routing.
Replaces CP-SAT as default for <1s solve times with better OTD-D.
"""

from .scheduler import schedule_all

__all__ = ["schedule_all"]
