"""E2E tests for twin (peça gémea) co-production through the CP-SAT pipeline.

Verifies that 6 twin pairs are correctly merged:
- Same machine + tool → co-production
- Both SKUs produced simultaneously
- Blocks share the same start_min on the same machine
- co_production_group_id links twin blocks
"""

from __future__ import annotations

from collections import defaultdict

import pytest

from src.domain.scheduling.transform import transform_plan_state
from src.domain.scheduling.types import Block
from src.domain.solver.bridge import engine_data_to_solver_request, solver_result_to_blocks
from src.domain.solver.router_logic import SolverRouter

# ── Fixture: 6 twin pairs on 3 machines ──────────────────────


def _build_twin_fixture() -> dict:
    """Build a synthetic PlanState with 6 twin pairs (12 ops total).

    Each pair shares the same tool and machine, with bidirectional twin references.
    """
    n_days = 15
    dates = [f"2026-04-{1 + i:02d}" for i in range(n_days)]
    weekdays = ["Qua", "Qui", "Sex", "Sáb", "Dom", "Seg", "Ter"]
    dnames = [weekdays[i % 7] for i in range(n_days)]

    # 6 twin pairs: (SKU_A, SKU_B) share same tool + machine
    twin_pairs = [
        # pair 0: PRM019, TOOL001, deadline day 8
        ("SKU_A0", "SKU_B0", "PRM019", "TOOL001", 300, 8),
        # pair 1: PRM019, TOOL002, deadline day 12
        ("SKU_A1", "SKU_B1", "PRM019", "TOOL002", 300, 12),
        # pair 2: PRM031, TOOL003, deadline day 6
        ("SKU_A2", "SKU_B2", "PRM031", "TOOL003", 400, 6),
        # pair 3: PRM031, TOOL004, deadline day 10
        ("SKU_A3", "SKU_B3", "PRM031", "TOOL004", 400, 10),
        # pair 4: PRM039, TOOL005, deadline day 7
        ("SKU_A4", "SKU_B4", "PRM039", "TOOL005", 350, 7),
        # pair 5: PRM039, TOOL006, deadline day 13
        ("SKU_A5", "SKU_B5", "PRM039", "TOOL006", 350, 13),
    ]

    ops = []
    for i, (sku_a, sku_b, machine, tool, ph, deadline) in enumerate(twin_pairs):
        # Small demand, spread deadlines to avoid infeasibility
        d_a = [None] * n_days
        d_b = [None] * n_days
        d_a[deadline] = -500
        d_b[deadline] = -400

        # SKU A references SKU B as twin, and vice versa
        ops.append(
            {
                "id": f"op_{sku_a}",
                "m": machine,
                "t": tool,
                "sku": sku_a,
                "nm": f"Part {sku_a}",
                "pH": ph,
                "atr": 0,
                "d": d_a,
                "op": 1,
                "sH": 0.75,
                "alt": "-",
                "eco": 0,
                "twin": sku_b,
            }
        )
        ops.append(
            {
                "id": f"op_{sku_b}",
                "m": machine,
                "t": tool,
                "sku": sku_b,
                "nm": f"Part {sku_b}",
                "pH": ph,
                "atr": 0,
                "d": d_b,
                "op": 1,
                "sH": 0.75,
                "alt": "-",
                "eco": 0,
                "twin": sku_a,
            }
        )

    return {
        "operations": ops,
        "dates": dates,
        "dnames": dnames,
    }


# ── Tests ─────────────────────────────────────────────────────


class TestTwinE2E:
    """Verify 6 twin pairs are correctly handled through CP-SAT pipeline."""

    @pytest.fixture
    def plan_state(self):
        return _build_twin_fixture()

    @pytest.fixture
    def engine_data(self, plan_state):
        return transform_plan_state(
            plan_state,
            demand_semantics="raw_np",
            order_based=True,
        )

    @pytest.fixture
    def solver_result(self, engine_data):
        request = engine_data_to_solver_request(engine_data, {})
        router = SolverRouter()
        return router.solve(request)

    @pytest.fixture
    def blocks(self, solver_result, engine_data):
        return solver_result_to_blocks(solver_result, engine_data)

    def test_twin_groups_detected(self, engine_data):
        """Transform should detect all 6 twin groups."""
        assert len(engine_data.twin_groups) >= 6, (
            f"Expected >= 6 twin groups, got {len(engine_data.twin_groups)}"
        )

    def test_twin_validation_no_anomalies(self, engine_data):
        """Twin validation should have no anomalies for bidirectional pairs."""
        report = engine_data.twin_validation_report
        assert len(report.anomalies) == 0, f"Expected 0 anomalies, got: {report.anomalies}"

    def test_solver_produces_blocks(self, blocks):
        """Solver should produce blocks for all twin operations."""
        assert len(blocks) > 0
        # Should have blocks for at least some of the 12 operations
        op_ids = {b.op_id for b in blocks}
        assert len(op_ids) >= 6, f"Only {len(op_ids)} unique op_ids in blocks"

    def test_twin_blocks_co_production(self, blocks):
        """Twin blocks should be marked as co-production."""
        twin_blocks = [b for b in blocks if b.is_twin_production]
        assert len(twin_blocks) > 0, "No twin production blocks found"

        # Co-production blocks should have a group ID
        for b in twin_blocks:
            assert b.co_production_group_id is not None, (
                f"Twin block {b.op_id} missing co_production_group_id"
            )

    def test_twin_blocks_same_start(self, blocks):
        """Twin pairs should share the same start time on the same machine.

        The bridge assigns each twin block its own co_production_group_id
        (prefixed with its own op_id), so we group by (machine, start_min)
        to find co-produced pairs.
        """
        twin_blocks = [b for b in blocks if b.is_twin_production]

        # Group by (machine_id, start_min) — co-produced blocks share both
        groups: dict[tuple[str, int], list[Block]] = defaultdict(list)
        for b in twin_blocks:
            groups[(b.machine_id, b.start_min)].append(b)

        co_prod_count = 0
        for key, group_blocks in groups.items():
            if len(group_blocks) >= 2:
                co_prod_count += 1
                # Same end_min (simultaneous production)
                ends = {b.end_min for b in group_blocks}
                assert len(ends) == 1, f"Co-production at {key} has different end times: {ends}"
                # Different SKUs
                skus = {b.sku for b in group_blocks}
                assert len(skus) == 2, f"Co-production at {key} has same SKU: {skus}"

        assert co_prod_count > 0, "No co-production pairs with shared start found"

    def test_twin_blocks_have_outputs(self, blocks):
        """Twin production blocks should have outputs listing both SKUs."""
        twin_blocks = [b for b in blocks if b.is_twin_production and b.outputs]
        assert len(twin_blocks) > 0, "No twin blocks with outputs found"

        for b in twin_blocks:
            # Each twin block should list 2 outputs (both SKU A and SKU B)
            assert len(b.outputs) == 2, (
                f"Twin block {b.op_id} has {len(b.outputs)} outputs, expected 2"
            )
            skus = {o.sku for o in b.outputs}
            assert len(skus) == 2, f"Twin block {b.op_id} outputs have same SKU: {skus}"

    def test_no_machine_overlap_except_twins(self, blocks):
        """Non-twin blocks should not overlap. Twin pairs intentionally share the same slot."""
        by_machine: dict[str, list[Block]] = defaultdict(list)
        for b in blocks:
            by_machine[b.machine_id].append(b)

        for mid, mblocks in by_machine.items():
            sorted_blocks = sorted(mblocks, key=lambda b: b.start_min)
            for i in range(len(sorted_blocks) - 1):
                a, b = sorted_blocks[i], sorted_blocks[i + 1]
                if a.end_min > b.start_min:
                    # Overlap is OK only if both are twin co-production on same slot
                    both_twin = a.is_twin_production and b.is_twin_production
                    same_slot = a.start_min == b.start_min and a.end_min == b.end_min
                    assert both_twin and same_slot, (
                        f"Non-twin overlap on {mid}: block ending at {a.end_min} "
                        f"vs block starting at {b.start_min}"
                    )
