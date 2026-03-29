"""Tests for Factory Config — Moldit Planner."""

from __future__ import annotations

import os
import tempfile

import pytest

from backend.config.loader import load_config, validate_config
from backend.config.types import FactoryConfig, MachineConfig, ShiftConfig


# -- FactoryConfig defaults --


class TestFactoryConfig:
    def test_default_values(self):
        c = FactoryConfig()
        assert c.day_capacity_min == 1020
        assert c.shift_a_start == 420
        assert c.shift_a_end == 930
        assert c.shift_b_end == 1440
        assert c.oee_default == 0.66
        assert c.default_setup_hours == 0.5
        assert c.max_run_days == 5
        assert c.max_edd_gap == 10
        assert c.lst_safety_buffer == 2
        assert c.edd_swap_tolerance == 5
        assert c.electrodos_default_h == 4.0

    def test_day_capacity_from_shifts(self):
        c = FactoryConfig()
        assert c.day_capacity_min == 510 + 510  # A=510, B=510

    def test_3_shifts_1440(self):
        c2 = FactoryConfig(shifts=[
            ShiftConfig("A", 360, 840),   # 480
            ShiftConfig("B", 840, 1320),  # 480
            ShiftConfig("C", 1320, 360),  # cross midnight: 480
        ])
        assert c2.day_capacity_min == 480 + 480 + 480

    def test_1_shift_510(self):
        c = FactoryConfig(shifts=[ShiftConfig("A", 420, 930)])
        assert c.day_capacity_min == 510

    def test_cross_midnight_shift(self):
        s = ShiftConfig("N", 1320, 360)  # 22:00-06:00
        assert s.duration_min == (1440 - 1320) + 360  # 480

    def test_machine_groups_property(self):
        c = FactoryConfig(machines={
            "FE16-Zayer": MachineConfig("FE16-Zayer", "Desbaste"),
            "FE31-MasterMill": MachineConfig("FE31-MasterMill", "Maq_3D_2D_GD"),
        })
        assert c.machine_groups == {
            "FE16-Zayer": "Desbaste",
            "FE31-MasterMill": "Maq_3D_2D_GD",
        }

    def test_inactive_machine_excluded(self):
        c = FactoryConfig(machines={
            "FE16-Zayer": MachineConfig("FE16-Zayer", "Desbaste", active=True),
            "FE22-Rambaudi": MachineConfig(
                "FE22-Rambaudi", "Desbaste", active=False,
            ),
        })
        assert "FE22-Rambaudi" not in c.machine_groups
        assert "FE16-Zayer" in c.machine_groups

    def test_machine_config_new_fields(self):
        mc = MachineConfig(
            id="FE16-Zayer", group="Desbaste",
            regime_h=16, setup_h=1.0, e_externo=False,
        )
        assert mc.regime_h == 16
        assert mc.setup_h == 1.0
        assert mc.e_externo is False
        assert mc.dedicacao == {}


# -- Load config --


class TestLoadConfig:
    def test_load_missing_file_returns_defaults(self):
        c = load_config("/nonexistent/factory.yaml")
        assert c.name == "Moldit"
        assert c.day_capacity_min == 1020

    def test_load_factory_yaml(self):
        yaml_path = os.path.join(
            os.path.dirname(__file__), "..", "config", "factory.yaml",
        )
        if os.path.exists(yaml_path):
            c = load_config(yaml_path)
            assert len(c.machines) >= 40
            assert c.name == "Moldit"
            assert c.site == "Marinha Grande"
            assert c.electrodos_default_h == 4.0

    def test_load_minimal_yaml(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False,
        ) as f:
            f.write("factory:\n  name: TestFactory\n")
            f.flush()
            c = load_config(f.name)
            assert c.name == "TestFactory"
            assert c.day_capacity_min == 1020
        os.unlink(f.name)

    def test_load_machines_with_regime(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False,
        ) as f:
            f.write(
                "machines:\n"
                "  FE16-Zayer: { group: Desbaste, regime_h: 16, setup_h: 1.0 }\n"
                "  Externo-Ret: { group: Externo, regime_h: 0, setup_h: 0 }\n"
            )
            f.flush()
            c = load_config(f.name)
            assert c.machines["FE16-Zayer"].regime_h == 16
            assert c.machines["Externo-Ret"].e_externo is True
        os.unlink(f.name)


# -- Validation --


class TestValidation:
    def test_valid_config_no_errors(self):
        errors = validate_config(FactoryConfig())
        assert errors == []

    def test_no_shifts_error(self):
        c = FactoryConfig(shifts=[])
        errors = validate_config(c)
        assert any("shift" in e.lower() or "turno" in e.lower() for e in errors)

    def test_oee_out_of_range(self):
        c = FactoryConfig(oee_default=1.5)
        errors = validate_config(c)
        assert any("oee" in e.lower() for e in errors)

    def test_scoring_weights_sum(self):
        c = FactoryConfig(
            weight_makespan=0.5,
            weight_deadline_compliance=0.5,
            weight_setups=0.5,
            weight_balance=0.5,
        )
        errors = validate_config(c)
        assert any("weight" in e.lower() for e in errors)


# -- Scheduler with config (Phase 3) --


class TestSchedulerWithConfig:
    def test_default_config_same_as_no_config(self):
        from backend.scheduler.scheduler import schedule_all
        from backend.types import MolditEngineData

        e = MolditEngineData()
        schedule_all(e)

    def test_config_backwards_compat(self):
        from backend.scheduler.scheduler import schedule_all
        from backend.types import MolditEngineData

        e = MolditEngineData()
        schedule_all(e, config=FactoryConfig())
