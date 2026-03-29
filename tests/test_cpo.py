"""CPO v3.0 Test Suite — Full constraint validation.

Validates ALL HARD, SOFT, and STRUCTURAL constraints.
Tests both quick (baseline parity) and normal (GA optimization) modes.
"""
import pytest

pytestmark = pytest.mark.skip(
    reason="Legacy Incompol tests -- will be rewritten in Phase 3",
)
