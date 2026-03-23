"""Frozen invariant tests — Twin outputs + JIT + merge_consecutive.

These tests FREEZE the following logic and MUST NEVER be weakened:

1. Twin outputs are PROPORTIONAL across sub-blocks (Fix 1)
   - When a twin bucket is split into multiple sub-blocks (shift boundary),
     each sub-block gets a proportional fraction of twin_outputs.qty
   - Sum of twin output qtys across all sub-blocks == bucket's run_qty

2. Twin outputs use run_qty = max(A, B) for BOTH ops (Fix 2)
   - Per CLAUDE.md: "Quantidade = max(|NP_A|, |NP_B|) para AMBAS. Excedente → stock."
   - Both ops in twin_outputs get the same qty = run_qty

3. _merge_consecutive merges twin outputs correctly (Fix 3)
   - When consecutive blocks are merged, their twin output qtys are SUMMED
   - Never drop twin outputs from merged blocks

4. OTD-D = 0 for the full pipeline with twins + JIT

DO NOT MODIFY THESE TESTS. If they fail, the code is broken.
"""

from __future__ import annotations

from collections import defaultdict

from src.domain.scheduler.demand_grouper import group_demand_into_buckets
from src.domain.scheduler.overflow_router import compute_otd_delivery_failures
from src.domain.scheduler.scheduler import _merge_consecutive, schedule_all
from src.domain.scheduling.types import (
    Block,
    EMachine,
    EngineData,
    EOp,
    ETool,
    TwinGroup,
    TwinOutput,
)

# ── Helpers ──


def _make_twin_engine_data(
    *,
    a_demands: list[int],
    b_demands: list[int],
    pH: int = 1000,
    setup_hours: float = 0.5,
    n_days: int = 20,
) -> EngineData:
    """Build minimal EngineData with one twin pair on one machine."""
    machine_id = "M1"
    tool_id = "T1"

    d_a = a_demands + [0] * (n_days - len(a_demands))
    d_b = b_demands + [0] * (n_days - len(b_demands))

    ops = [
        EOp(id="OP_A", t=tool_id, m=machine_id, sku="SKU_A", nm="A", d=d_a, pH=pH),
        EOp(id="OP_B", t=tool_id, m=machine_id, sku="SKU_B", nm="B", d=d_b, pH=pH),
    ]

    tool = ETool(id=tool_id, m=machine_id, sH=setup_hours, pH=pH, op=1, oee=0.66)

    twin_group = TwinGroup(
        op_id1="OP_A",
        op_id2="OP_B",
        sku1="SKU_A",
        sku2="SKU_B",
        machine=machine_id,
        tool=tool_id,
        pH=pH,
        operators=1,
    )

    workdays = [True] * n_days

    return EngineData(
        machines=[EMachine(id=machine_id, area="grandes")],
        tools=[tool],
        ops=ops,
        tool_map={tool_id: tool},
        workdays=workdays,
        n_days=n_days,
        twin_groups=[twin_group],
        order_based=True,
    )


# ═══════════════════════════════════════════════════════════
# FROZEN INVARIANT 1: Twin outputs proportional in sub-blocks
# ═══════════════════════════════════════════════════════════


class TestFrozenTwinOutputProportional:
    """Each sub-block's twin output qty must be proportional to its production.
    Sum across all sub-blocks of one bucket MUST equal the bucket's run_qty.
    """

    def test_twin_output_sum_equals_run_qty(self):
        """Sum of twin outputs across sub-blocks == run_qty (no inflation)."""
        # Create a twin pair where A=500, B=800 → run_qty=800
        ed = _make_twin_engine_data(
            a_demands=[500, 0, 0],
            b_demands=[800, 0, 0],
            pH=100,  # 100 pcs/hr → 800 pcs needs 12.12h → splits across shifts
            n_days=10,
        )

        result = schedule_all(ed, settings={"disableJIT": True})
        blocks = result.blocks

        # Collect twin output per op across all ok blocks
        twin_out_a = 0
        twin_out_b = 0
        for b in blocks:
            if b.type == "ok" and b.outputs:
                for out in b.outputs:
                    if out.op_id == "OP_A":
                        twin_out_a += out.qty
                    elif out.op_id == "OP_B":
                        twin_out_b += out.qty

        # Both must equal run_qty = max(500, 800) = 800
        assert twin_out_a == 800, f"OP_A twin output total {twin_out_a} != 800"
        assert twin_out_b == 800, f"OP_B twin output total {twin_out_b} != 800"

    def test_no_sub_block_has_full_qty_when_split(self):
        """When bucket is split, NO sub-block should have the FULL qty."""
        # Large production that MUST split across shifts
        ed = _make_twin_engine_data(
            a_demands=[2000, 0, 0],
            b_demands=[3000, 0, 0],
            pH=100,  # 3000 pcs at 100/hr/0.66 = 45.45h → many sub-blocks
            n_days=20,
        )

        result = schedule_all(ed, settings={"disableJIT": True})
        blocks = [b for b in result.blocks if b.type == "ok" and b.outputs]

        if len(blocks) > 1:
            # If there are multiple sub-blocks, none should have full qty
            for b in blocks:
                for out in b.outputs:
                    if out.op_id == "OP_A":
                        assert out.qty < 3000, f"Sub-block has full qty {out.qty} — inflation bug!"

    def test_twin_outputs_never_negative(self):
        """Twin output qty must never be negative (remainder tracking bug)."""
        ed = _make_twin_engine_data(
            a_demands=[100, 200, 300, 400, 500],
            b_demands=[150, 250, 350, 450, 550],
            pH=80,
            n_days=20,
        )

        result = schedule_all(ed, settings={"disableJIT": True})
        for b in result.blocks:
            if b.type == "ok" and b.outputs:
                for out in b.outputs:
                    assert out.qty >= 0, f"Negative twin output: {out.op_id} qty={out.qty}"


# ═══════════════════════════════════════════════════════════
# FROZEN INVARIANT 2: Twin outputs = run_qty for BOTH ops
# ═══════════════════════════════════════════════════════════


class TestFrozenTwinRunQty:
    """Both twin ops MUST get run_qty = max(A, B) pieces.
    Per CLAUDE.md: 'Excedente → stock'.
    """

    def test_both_twins_get_max_qty(self):
        """run_qty = max(A, B). Both ops get run_qty. Surplus → stock."""
        ed = _make_twin_engine_data(
            a_demands=[500],
            b_demands=[800],
            pH=1000,
            n_days=5,
        )

        mg = group_demand_into_buckets(
            ops=ed.ops,
            tool_map=ed.tool_map,
            twin_groups=ed.twin_groups,
            workdays=ed.workdays,
            n_days=ed.n_days,
            order_based=True,
        )

        # Find the twin bucket
        for mid, groups in mg.items():
            for grp in groups:
                for bkt in grp.buckets:
                    if bkt.is_twin_production and bkt.twin_outputs:
                        out_a = next(o for o in bkt.twin_outputs if o[0] == "OP_A")
                        out_b = next(o for o in bkt.twin_outputs if o[0] == "OP_B")
                        # Both MUST get run_qty = max(500, 800) = 800
                        assert out_a[2] == 800, f"OP_A gets {out_a[2]}, expected 800"
                        assert out_b[2] == 800, f"OP_B gets {out_b[2]}, expected 800"
                        return

        raise AssertionError("No twin bucket found")

    def test_symmetric_twins_equal_qty(self):
        """When both twins have same demand, both get that demand."""
        ed = _make_twin_engine_data(
            a_demands=[600],
            b_demands=[600],
            pH=1000,
            n_days=5,
        )

        mg = group_demand_into_buckets(
            ops=ed.ops,
            tool_map=ed.tool_map,
            twin_groups=ed.twin_groups,
            workdays=ed.workdays,
            n_days=ed.n_days,
            order_based=True,
        )

        for mid, groups in mg.items():
            for grp in groups:
                for bkt in grp.buckets:
                    if bkt.is_twin_production and bkt.twin_outputs:
                        out_a = next(o for o in bkt.twin_outputs if o[0] == "OP_A")
                        out_b = next(o for o in bkt.twin_outputs if o[0] == "OP_B")
                        assert out_a[2] == 600
                        assert out_b[2] == 600
                        return

    def test_multi_day_twin_run_qty_per_pair(self):
        """Each twin pair independently gets max(A_i, B_i)."""
        ed = _make_twin_engine_data(
            a_demands=[100, 0, 300],
            b_demands=[200, 0, 100],
            pH=1000,
            n_days=10,
        )

        mg = group_demand_into_buckets(
            ops=ed.ops,
            tool_map=ed.tool_map,
            twin_groups=ed.twin_groups,
            workdays=ed.workdays,
            n_days=ed.n_days,
            order_based=True,
        )

        twin_outputs_by_edd: dict[int, list] = {}
        for mid, groups in mg.items():
            for grp in groups:
                for bkt in grp.buckets:
                    if bkt.is_twin_production and bkt.twin_outputs:
                        twin_outputs_by_edd[bkt.edd] = bkt.twin_outputs

        # EDD 0: A=100, B=200 → run_qty=200
        if 0 in twin_outputs_by_edd:
            outs = twin_outputs_by_edd[0]
            for o in outs:
                assert o[2] == 200, f"EDD 0: got {o[2]}, expected 200"

        # EDD 2: A=300, B=100 → run_qty=300
        if 2 in twin_outputs_by_edd:
            outs = twin_outputs_by_edd[2]
            for o in outs:
                assert o[2] == 300, f"EDD 2: got {o[2]}, expected 300"


# ═══════════════════════════════════════════════════════════
# FROZEN INVARIANT 3: _merge_consecutive preserves twin outputs
# ═══════════════════════════════════════════════════════════


class TestFrozenMergeConsecutiveTwinOutputs:
    """When blocks are merged, twin output qtys MUST be summed."""

    def test_merge_sums_twin_outputs(self):
        """Two consecutive blocks with twin outputs → merged outputs sum."""
        b1 = Block(
            op_id="OP_A",
            tool_id="T1",
            machine_id="M1",
            day_idx=0,
            start_min=420,
            end_min=930,
            prod_min=510,
            qty=5000,
            type="ok",
            shift="X",
            is_twin_production=True,
            co_production_group_id="twin-1",
            outputs=[
                TwinOutput(op_id="OP_A", sku="SKU_A", qty=5000),
                TwinOutput(op_id="OP_B", sku="SKU_B", qty=5000),
            ],
        )
        b2 = Block(
            op_id="OP_A",
            tool_id="T1",
            machine_id="M1",
            day_idx=0,
            start_min=930,
            end_min=1200,
            prod_min=270,
            qty=2700,
            type="ok",
            shift="Y",
            is_twin_production=True,
            co_production_group_id="twin-1",
            outputs=[
                TwinOutput(op_id="OP_A", sku="SKU_A", qty=2700),
                TwinOutput(op_id="OP_B", sku="SKU_B", qty=2700),
            ],
        )

        merged = _merge_consecutive([b1, b2])

        assert len(merged) == 1, f"Expected 1 merged block, got {len(merged)}"
        m = merged[0]
        assert m.qty == 7700, f"Merged qty {m.qty} != 7700"
        assert m.outputs is not None, "Merged block lost twin outputs!"
        assert len(m.outputs) == 2

        out_a = next(o for o in m.outputs if o.op_id == "OP_A")
        out_b = next(o for o in m.outputs if o.op_id == "OP_B")
        assert out_a.qty == 7700, f"OP_A merged output {out_a.qty} != 7700"
        assert out_b.qty == 7700, f"OP_B merged output {out_b.qty} != 7700"

    def test_merge_preserves_when_no_outputs(self):
        """Non-twin blocks merge normally without outputs."""
        b1 = Block(
            op_id="OP_X",
            tool_id="T1",
            machine_id="M1",
            day_idx=0,
            start_min=420,
            end_min=930,
            prod_min=510,
            qty=5000,
            type="ok",
            shift="X",
        )
        b2 = Block(
            op_id="OP_X",
            tool_id="T1",
            machine_id="M1",
            day_idx=0,
            start_min=930,
            end_min=1200,
            prod_min=270,
            qty=2700,
            type="ok",
            shift="Y",
        )

        merged = _merge_consecutive([b1, b2])
        assert len(merged) == 1
        assert merged[0].qty == 7700
        assert merged[0].outputs is None

    def test_merge_does_not_merge_different_ops(self):
        """Different op_ids are NOT merged."""
        b1 = Block(
            op_id="OP_A",
            tool_id="T1",
            machine_id="M1",
            day_idx=0,
            start_min=420,
            end_min=930,
            prod_min=510,
            qty=5000,
            type="ok",
            shift="X",
            outputs=[TwinOutput(op_id="OP_A", sku="A", qty=5000)],
        )
        b2 = Block(
            op_id="OP_B",
            tool_id="T1",
            machine_id="M1",
            day_idx=0,
            start_min=930,
            end_min=1200,
            prod_min=270,
            qty=2700,
            type="ok",
            shift="Y",
            outputs=[TwinOutput(op_id="OP_B", sku="B", qty=2700)],
        )

        merged = _merge_consecutive([b1, b2])
        assert len(merged) == 2, "Different ops should NOT merge"

    def test_merge_three_consecutive_twin_blocks(self):
        """Three consecutive twin blocks → one merged block with summed outputs."""
        blocks = []
        for i, (start, end, qty) in enumerate(
            [
                (420, 930, 5000),
                (930, 1200, 2700),
                (1200, 1440, 2400),
            ]
        ):
            blocks.append(
                Block(
                    op_id="OP_A",
                    tool_id="T1",
                    machine_id="M1",
                    day_idx=0,
                    start_min=start,
                    end_min=end,
                    prod_min=end - start,
                    qty=qty,
                    type="ok",
                    shift="X",
                    is_twin_production=True,
                    outputs=[
                        TwinOutput(op_id="OP_A", sku="A", qty=qty),
                        TwinOutput(op_id="OP_B", sku="B", qty=qty),
                    ],
                )
            )

        merged = _merge_consecutive(blocks)
        assert len(merged) == 1
        m = merged[0]
        assert m.qty == 10100
        assert m.outputs is not None
        out_a = next(o for o in m.outputs if o.op_id == "OP_A")
        out_b = next(o for o in m.outputs if o.op_id == "OP_B")
        assert out_a.qty == 10100, f"3-way merge OP_A: {out_a.qty} != 10100"
        assert out_b.qty == 10100, f"3-way merge OP_B: {out_b.qty} != 10100"


# ═══════════════════════════════════════════════════════════
# FROZEN INVARIANT 4: OTD-D = 0 with twins + JIT
# ═══════════════════════════════════════════════════════════


class TestFrozenOtdDelivery:
    """OTD-D MUST be 0 (100%) for twin schedules with JIT enabled."""

    def _assert_zero_otd_failures(self, ed: EngineData, label: str):
        result = schedule_all(ed, settings={})  # JIT ON
        blocks = result.blocks
        failures = compute_otd_delivery_failures(blocks, ed.ops)
        assert len(failures) == 0, (
            f"{label}: {len(failures)} OTD-D failures! First: {failures[0] if failures else 'N/A'}"
        )

    def test_simple_twin_zero_otd_d(self):
        """Simple twin pair: 0 OTD-D failures."""
        ed = _make_twin_engine_data(
            a_demands=[500, 0, 300],
            b_demands=[400, 0, 600],
            pH=1000,
            n_days=10,
        )
        self._assert_zero_otd_failures(ed, "simple twin")

    def test_asymmetric_twin_zero_otd_d(self):
        """Asymmetric twin (A >> B): 0 OTD-D failures."""
        ed = _make_twin_engine_data(
            a_demands=[1000, 500, 200],
            b_demands=[100, 50, 20],
            pH=500,
            n_days=10,
        )
        self._assert_zero_otd_failures(ed, "asymmetric twin")

    def test_heavy_twin_production_zero_otd_d(self):
        """Heavy twin production spanning many shifts: 0 OTD-D failures."""
        ed = _make_twin_engine_data(
            a_demands=[2000, 0, 1500, 0, 0, 3000],
            b_demands=[1000, 0, 2500, 0, 0, 1000],
            pH=200,
            n_days=20,
        )
        self._assert_zero_otd_failures(ed, "heavy twin")

    def test_jit_does_not_create_otd_failures(self):
        """JIT right-shift MUST NOT introduce OTD-D failures."""
        ed = _make_twin_engine_data(
            a_demands=[100, 200, 300, 400, 500],
            b_demands=[150, 250, 350, 450, 550],
            pH=200,
            n_days=20,
        )

        # Without JIT
        r_no_jit = schedule_all(ed, settings={"disableJIT": True})
        f_no_jit = compute_otd_delivery_failures(r_no_jit.blocks, ed.ops)

        # With JIT
        r_jit = schedule_all(ed, settings={})
        f_jit = compute_otd_delivery_failures(r_jit.blocks, ed.ops)

        assert len(f_no_jit) == 0, f"Base has {len(f_no_jit)} failures"
        assert len(f_jit) == 0, f"JIT introduced {len(f_jit)} failures"


# ═══════════════════════════════════════════════════════════
# FROZEN INVARIANT 5: Production conservation for twins
# ═══════════════════════════════════════════════════════════


class TestFrozenTwinProductionConservation:
    """Total produced per op MUST >= total demand. Twin surplus is ok."""

    def test_production_covers_demand(self):
        """Each op's total production >= its total demand."""
        ed = _make_twin_engine_data(
            a_demands=[500, 0, 300, 0, 200],
            b_demands=[400, 0, 600, 0, 100],
            pH=500,
            n_days=15,
        )

        result = schedule_all(ed, settings={})
        blocks = result.blocks

        # Sum production per op (twin-aware)
        op_prod: dict[str, int] = defaultdict(int)
        for b in blocks:
            if b.type == "ok":
                if b.outputs:
                    for out in b.outputs:
                        op_prod[out.op_id] += out.qty
                else:
                    op_prod[b.op_id] += b.qty

        # Sum demand per op
        for op in ed.ops:
            demand = sum(max(v, 0) for v in op.d) + op.atr
            produced = op_prod.get(op.id, 0)
            assert produced >= demand, f"{op.id}: produced {produced} < demand {demand}"

    def test_twin_surplus_is_positive(self):
        """Twin with smaller demand gets surplus (produced > demand)."""
        ed = _make_twin_engine_data(
            a_demands=[500],
            b_demands=[800],
            pH=1000,
            n_days=5,
        )

        result = schedule_all(ed, settings={})
        blocks = result.blocks

        op_prod: dict[str, int] = defaultdict(int)
        for b in blocks:
            if b.type == "ok" and b.outputs:
                for out in b.outputs:
                    op_prod[out.op_id] += out.qty

        # OP_A has demand 500 but gets 800 (surplus 300)
        assert op_prod["OP_A"] == 800, f"OP_A produced {op_prod['OP_A']}, expected 800"
        assert op_prod["OP_B"] == 800, f"OP_B produced {op_prod['OP_B']}, expected 800"
        # Surplus for A = 800 - 500 = 300
        assert op_prod["OP_A"] - 500 == 300, "OP_A surplus should be 300"
