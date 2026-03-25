"""Tests for simulator — Spec 04: What-If mutations."""

from __future__ import annotations

from backend.simulator import DeltaReport, Mutation, SimulateResponse, simulate
from backend.simulator.mutations import apply_mutation, mutation_summary
from backend.scheduler.scheduler import schedule_all
from backend.types import ClientDemandEntry, EngineData, EOp, MachineInfo, TwinGroup

WORKDAYS = [
    "2026-03-05", "2026-03-06", "2026-03-07",
    "2026-03-10", "2026-03-11", "2026-03-12",
]


# --- Fixtures ---

def _eop(
    op_id: str = "op1",
    sku: str = "SKU1",
    machine: str = "M1",
    tool: str = "T1",
    d: list[int] | None = None,
    pH: float = 100.0,
    sH: float = 0.5,
    oee: float = 0.66,
    alt: str | None = None,
    eco_lot: int = 0,
) -> EOp:
    return EOp(
        id=op_id, sku=sku, client="CLIENT", designation="Test",
        m=machine, t=tool, pH=pH, sH=sH, operators=1,
        eco_lot=eco_lot, alt=alt, stk=0, backlog=0,
        d=d or [0, 500, 0, 300, 0], oee=oee, wip=0,
    )


def _engine(
    ops: list[EOp] | None = None,
    n_days: int = 6,
    holidays: list[int] | None = None,
    extra_machines: list[str] | None = None,
) -> EngineData:
    ops = ops or [_eop()]
    machines = [MachineInfo(id="M1", group="Grandes", day_capacity=1020)]
    for mid in (extra_machines or []):
        machines.append(MachineInfo(id=mid, group="Grandes", day_capacity=1020))
    return EngineData(
        ops=ops,
        machines=machines,
        twin_groups=[],
        client_demands={},
        workdays=WORKDAYS[:n_days],
        n_days=n_days,
        holidays=holidays or [],
    )


# --- Tests ---

class TestNoMutations:
    def test_score_identical_to_baseline(self):
        """No mutations → score equals baseline."""
        data = _engine()
        baseline = schedule_all(data)

        resp = simulate(data, baseline.score, [])

        assert resp.score["otd"] == baseline.score["otd"]
        assert resp.score["otd_d"] == baseline.score["otd_d"]
        assert resp.score["setups"] == baseline.score["setups"]
        assert resp.delta.otd_before == resp.delta.otd_after
        assert resp.delta.setups_before == resp.delta.setups_after

    def test_response_structure(self):
        """SimulateResponse has all expected fields."""
        data = _engine()
        baseline = schedule_all(data)
        resp = simulate(data, baseline.score, [])

        assert isinstance(resp, SimulateResponse)
        assert isinstance(resp.delta, DeltaReport)
        assert isinstance(resp.segments, list)
        assert isinstance(resp.lots, list)
        assert isinstance(resp.summary, list)
        assert resp.time_ms >= 0


class TestRushOrder:
    def test_demand_increases(self):
        """Rush order adds demand to the specified day."""
        data = _engine()
        baseline = schedule_all(data)

        mutations = [Mutation(type="rush_order", params={
            "sku": "SKU1", "qty": 1000, "deadline_day": 4,
        })]
        resp = simulate(data, baseline.score, mutations)

        # More lots expected
        assert len(resp.lots) >= len(baseline.lots)
        assert any("urgente" in s for s in resp.summary)


class TestCancelOrder:
    def test_demand_zeroed(self):
        """Cancel order zeros demand in day range."""
        data = _engine()
        baseline = schedule_all(data)

        mutations = [Mutation(type="cancel_order", params={
            "sku": "SKU1", "from_day": 0, "to_day": 5,
        })]
        resp = simulate(data, baseline.score, mutations)

        # All demand cancelled → fewer or no lots
        assert len(resp.lots) <= len(baseline.lots)


class TestOeeChange:
    def test_oee_affects_schedule(self):
        """Changing OEE re-schedules (different prod times)."""
        data = _engine()
        baseline = schedule_all(data)

        mutations = [Mutation(type="oee_change", params={
            "tool_id": "T1", "new_oee": 0.30,
        })]
        resp = simulate(data, baseline.score, mutations)

        # Lower OEE → longer prod times → different schedule
        assert isinstance(resp.score, dict)
        assert resp.score["total_lots"] > 0


class TestAddHoliday:
    def test_holiday_added(self):
        """Adding a holiday affects the schedule."""
        data = _engine()
        baseline = schedule_all(data)

        mutations = [Mutation(type="add_holiday", params={"day_idx": 1})]
        resp = simulate(data, baseline.score, mutations)

        assert isinstance(resp.score, dict)
        assert any("Feriado" in s for s in resp.summary)


class TestRemoveHoliday:
    def test_holiday_removed(self):
        """Removing a holiday from existing holidays."""
        data = _engine(holidays=[2])
        baseline = schedule_all(data)

        mutations = [Mutation(type="remove_holiday", params={"day_idx": 2})]
        resp = simulate(data, baseline.score, mutations)

        assert any("removido" in s for s in resp.summary)


class TestSummaryPortuguese:
    def test_summary_in_portuguese(self):
        """Summary strings are in Portuguese."""
        data = _engine()
        baseline = schedule_all(data)

        mutations = [
            Mutation(type="rush_order", params={"sku": "SKU1", "qty": 500, "deadline_day": 3}),
            Mutation(type="add_holiday", params={"day_idx": 0}),
        ]
        resp = simulate(data, baseline.score, mutations)

        # At least mutation summaries + delta summary
        assert len(resp.summary) >= 3
        # Check Portuguese content
        all_text = " ".join(resp.summary)
        assert any(word in all_text for word in ["urgente", "Feriado", "Resumo", "Sem alterações"])


class TestDeltaReport:
    def test_delta_fields_correct(self):
        """Delta report reflects baseline vs mutated scores."""
        data = _engine()
        baseline = schedule_all(data)

        resp = simulate(data, baseline.score, [])

        assert resp.delta.otd_before == baseline.score["otd"]
        assert resp.delta.otd_after == resp.score["otd"]
        assert resp.delta.setups_before == baseline.score["setups"]
        assert resp.delta.setups_after == resp.score["setups"]
        assert resp.delta.tardy_before == baseline.score["tardy_count"]
        assert resp.delta.tardy_after == resp.score["tardy_count"]


class TestMutationSummary:
    def test_all_types_have_summary(self):
        """mutation_summary works for all 13 types."""
        types = [
            "machine_down", "tool_down", "operator_shortage", "oee_change",
            "rush_order", "demand_change", "cancel_order", "third_shift",
            "overtime", "add_holiday", "remove_holiday", "force_machine",
            "change_eco_lot",
        ]
        for t in types:
            s = mutation_summary(t, {})
            assert isinstance(s, str)
            assert len(s) > 0


class TestMutationApply:
    def test_demand_change_factor(self):
        """demand_change scales demand by factor."""
        data = _engine(ops=[_eop(d=[0, 100, 0, 200, 0])])
        apply_mutation(data, "demand_change", {"sku": "SKU1", "factor": 2.0})
        op = data.ops[0]
        assert op.d[1] == 200
        assert op.d[3] == 400

    def test_force_machine(self):
        """force_machine changes machine and clears alt."""
        data = _engine(ops=[_eop(alt="M2")], extra_machines=["M2"])
        apply_mutation(data, "force_machine", {"tool_id": "T1", "to_machine": "M2"})
        op = data.ops[0]
        assert op.m == "M2"
        assert op.alt is None

    def test_change_eco_lot(self):
        """change_eco_lot updates eco_lot for matching SKU."""
        data = _engine(ops=[_eop(eco_lot=100)])
        apply_mutation(data, "change_eco_lot", {"sku": "SKU1", "new_eco_lot": 500})
        assert data.ops[0].eco_lot == 500

    def test_third_shift_capacity(self):
        """third_shift adds night shift to config.shifts, increasing day_capacity_min."""
        from backend.config.types import FactoryConfig
        data = _engine()
        config = FactoryConfig()
        original_cap = config.day_capacity_min
        apply_mutation(data, "third_shift", {"machine_id": "M1"}, config=config)
        assert config.day_capacity_min == original_cap + 420
        assert any(s.id == "C" for s in config.shifts)

    def test_overtime_capacity(self):
        """overtime extends last shift, increasing day_capacity_min."""
        from backend.config.types import FactoryConfig
        data = _engine()
        config = FactoryConfig()
        original_cap = config.day_capacity_min
        apply_mutation(data, "overtime", {"machine_id": "M1", "extra_min": 120}, config=config)
        assert config.day_capacity_min == original_cap + 120

    def test_tool_down_blocks_tool(self):
        """tool_down adds per-tool blocked days (demand preserved)."""
        data = _engine(ops=[_eop(d=[100, 200, 300, 400, 500])])
        apply_mutation(data, "tool_down", {"tool_id": "T1", "start": 1, "end": 3})
        # Demand is preserved (not zeroed)
        assert data.ops[0].d == [100, 200, 300, 400, 500]
        # Tool blocked days are set
        assert data.tool_blocked_days["T1"] == {1, 2, 3}

    def test_machine_down_blocks_machine(self):
        """machine_down adds per-machine blocked days (not global holidays)."""
        data = _engine()
        apply_mutation(data, "machine_down", {"machine_id": "M1", "start": 2, "end": 4})
        # Global holidays untouched
        assert data.holidays == []
        # Per-machine blocked days set
        assert data.machine_blocked_days["M1"] == {2, 3, 4}


class TestOriginalDataUnchanged:
    def test_simulate_does_not_mutate_original(self):
        """simulate() must not modify the original EngineData."""
        data = _engine(ops=[_eop(d=[0, 500, 0, 300, 0])])
        original_demand = list(data.ops[0].d)
        baseline = schedule_all(data)

        simulate(data, baseline.score, [
            Mutation(type="cancel_order", params={"sku": "SKU1", "from_day": 0, "to_day": 5}),
        ])

        # Original data untouched
        assert data.ops[0].d == original_demand
