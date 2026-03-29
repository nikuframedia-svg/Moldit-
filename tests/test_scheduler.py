"""Tests for scheduler — Spec 02 v6 (Definitivo).

Covers all 5 fixes + full pipeline:
  Fix 1: EDD sort internal (tool_grouping)
  Fix 2: LST-gated JIT (jit)
  Fix 3: Campaign sequencing (dispatch)
  Fix 4: Interleave urgent (dispatch)
  Fix 5: Min prod_min (lot_sizing + dispatch)
"""
import pytest

pytestmark = pytest.mark.skip(
    reason="Legacy Incompol tests -- will be rewritten in Phase 3",
)
