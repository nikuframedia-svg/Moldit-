"""Tests for PORT-00: Types + Config + Utils."""

from __future__ import annotations

from src.domain.scheduling.config import (
    DEFAULT_SCHEDULING_CONFIG,
    SchedulingConfig,
    Weights,
    validate_config,
)
from src.domain.scheduling.constants import DAY_CAP, DEFAULT_OEE, S0, S1, T1
from src.domain.scheduling.types import Block, EMachine, EngineData, EOp, ETool, ScheduleResult
from src.domain.scheduling.utils import (
    fmt_min,
    from_abs,
    get_shift,
    get_shift_end,
    get_shift_start,
    infer_workdays_from_labels,
    mulberry32,
    pad_mo_array,
    to_abs,
)

# ── PRNG tests ──


def test_mulberry32_deterministic():
    """Same seed → same first 10 values."""
    rng1 = mulberry32(42)
    rng2 = mulberry32(42)
    for _ in range(10):
        assert rng1() == rng2()


def test_mulberry32_range():
    """All values in [0, 1)."""
    rng = mulberry32(42)
    for _ in range(100):
        v = rng()
        assert 0 <= v < 1


def test_mulberry32_different_seeds():
    """Different seeds → different sequences."""
    rng1 = mulberry32(42)
    rng2 = mulberry32(99)
    vals1 = [rng1() for _ in range(10)]
    vals2 = [rng2() for _ in range(10)]
    assert vals1 != vals2


# ── Constants tests ──


def test_constants():
    """Frozen constants have expected values."""
    assert S0 == 420
    assert T1 == 930
    assert S1 == 1440
    assert DAY_CAP == 1020
    assert DEFAULT_OEE == 0.66


# ── Time utils tests ──


def test_fmt_min():
    assert fmt_min(420) == "07:00"
    assert fmt_min(930) == "15:30"
    assert fmt_min(0) == "00:00"
    assert fmt_min(1440) == "00:00"  # wraps


def test_to_abs_from_abs():
    assert to_abs(0, 420) == 420
    assert to_abs(1, 0) == 1440
    assert from_abs(420) == (0, 420)
    assert from_abs(1440) == (1, 0)


def test_get_shift():
    assert get_shift(420) == "X"
    assert get_shift(929) == "X"
    assert get_shift(930) == "Y"
    assert get_shift(1439) == "Y"
    assert get_shift(100, third_shift=True) == "Z"
    assert get_shift(100, third_shift=False) == "X"


def test_get_shift_boundaries():
    assert get_shift_start("X") == 420
    assert get_shift_end("X") == 930
    assert get_shift_start("Y") == 930
    assert get_shift_end("Y") == 1440


def test_infer_workdays():
    labels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
    wd = infer_workdays_from_labels(labels, 7)
    assert wd == [True, True, True, True, True, False, False]


def test_pad_mo_array():
    assert pad_mo_array([], 5, "nominal", 6) == [99, 99, 99, 99, 99]
    assert pad_mo_array([3, 4], 5, "cyclic", 6) == [3, 4, 3, 4, 3]
    assert pad_mo_array([3, 4], 5, "nominal", 6) == [3, 4, 6, 6, 6]


# ── Type model tests ──


def test_eop_validates():
    op = EOp(id="op1", t="BFP001", m="PRM019", sku="REF001", d=[0, 0, -2000, -3000])
    assert op.sku == "REF001"
    assert len(op.d) == 4


def test_etool_defaults():
    tool = ETool(id="BFP001", m="PRM019", nm="Tool 1")
    assert tool.alt == "-"
    assert tool.sH == 0.75
    assert tool.oee is None


def test_emachine():
    m = EMachine(id="PRM019", area="Grandes")
    assert m.focus is True


def test_block_defaults():
    b = Block(op_id="op1", tool_id="BFP001", machine_id="PRM019")
    assert b.type == "ok"
    assert b.shift == "X"
    assert b.is_twin_production is False


def test_engine_data():
    data = EngineData(n_days=80, order_based=True)
    assert data.n_days == 80
    assert data.order_based is True
    assert len(data.ops) == 0


def test_schedule_result():
    result = ScheduleResult()
    assert len(result.blocks) == 0
    assert result.feasibility is None


# ── Config tests ──


def test_config_defaults():
    cfg = DEFAULT_SCHEDULING_CONFIG
    assert cfg.version == 2
    assert cfg.dispatch_rule == "ATCS"
    assert cfg.weights.otd == 0.7
    assert cfg.frozen_horizon_days == 5
    assert cfg.constraints.setup_crew.mode == "hard"


def test_config_weights_sum():
    """Weights must sum to 1.0."""
    w = Weights(otd=0.5, setup=0.3, utilization=0.2)
    assert abs(w.otd + w.setup + w.utilization - 1.0) < 0.001


def test_validate_config():
    cfg = validate_config({"dispatch_rule": "EDD", "frozen_horizon_days": 3})
    assert cfg.dispatch_rule == "EDD"
    assert cfg.frozen_horizon_days == 3


def test_config_with_policy():
    cfg = SchedulingConfig(
        weights=Weights(otd=0.9, setup=0.05, utilization=0.05),
        dispatch_rule="EDD",
        emergency_night_shift=True,
    )
    assert cfg.weights.otd == 0.9
    assert cfg.emergency_night_shift is True
