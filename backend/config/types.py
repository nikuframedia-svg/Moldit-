"""Factory configuration types — Moldit Planner."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ShiftConfig:
    """Single shift definition."""

    id: str
    start_min: int  # minutes from midnight (07:00 = 420)
    end_min: int    # minutes from midnight (00:00 = 1440)
    label: str = ""

    @property
    def duration_min(self) -> int:
        if self.end_min > self.start_min:
            return self.end_min - self.start_min
        # Cross-midnight shift (e.g. 22:00-06:00)
        return (1440 - self.start_min) + self.end_min


@dataclass
class MachineConfig:
    """Single machine definition."""

    id: str
    group: str
    active: bool = True
    regime_h: int = 16
    regime_pico_h: int = 0  # 0 = no peak mode. 24 = extended shift
    setup_h: float = 1.0
    e_externo: bool = False
    dedicacao: dict[str, float] = field(default_factory=dict)


@dataclass
class FactoryConfig:
    """Complete factory configuration."""

    # Identity
    name: str = "Moldit"
    site: str = ""
    timezone: str = "Europe/Lisbon"

    # Shifts (defaults = Moldit: A 07:00-15:30, B 15:30-00:00)
    shifts: list[ShiftConfig] = field(default_factory=lambda: [
        ShiftConfig("A", 420, 930, "Manha"),
        ShiftConfig("B", 930, 1440, "Tarde"),
    ])

    # Computed from shifts
    @property
    def day_capacity_min(self) -> int:
        return sum(s.duration_min for s in self.shifts)

    @property
    def shift_a_start(self) -> int:
        return self.shifts[0].start_min if self.shifts else 420

    @property
    def shift_a_end(self) -> int:
        return self.shifts[0].end_min if self.shifts else 930

    @property
    def shift_b_end(self) -> int:
        return self.shifts[-1].end_min if len(self.shifts) > 1 else 1440

    # Machines
    machines: dict[str, MachineConfig] = field(default_factory=dict)

    @property
    def machine_groups(self) -> dict[str, str]:
        if self.machines:
            return {mid: m.group for mid, m in self.machines.items() if m.active}
        return {}

    # Tools
    tools: dict[str, dict] = field(default_factory=dict)
    default_setup_hours: float = 0.5

    # Operators: (group, shift) -> count
    operators: dict[tuple[str, str], int] = field(default_factory=dict)

    # Holidays (ISO date strings)
    holidays: list[str] = field(default_factory=list)

    # Moldit-specific
    electrodos_default_h: float = 4.0
    bancada_dedicacao: dict = field(default_factory=dict)
    compatibilidade: dict = field(default_factory=dict)

    # Scheduler tunables
    max_run_days: int = 5
    max_edd_gap: int = 10
    max_edd_span: int = 30
    edd_swap_tolerance: int = 5
    edd_assign_threshold: int = 5
    lst_safety_buffer: int = 2
    urgency_threshold: int = 5
    auto_buffer: bool = True

    # ATCS dispatch parameters
    atcs_k1: float = 1.5       # urgency sensitivity [0.5, 3.0]
    atcs_k2: float = 0.5       # setup sensitivity [0.1, 2.0]

    # VNS post-processing
    vns_enabled: bool = True
    vns_max_iter: int = 150

    # Scoring weights
    weight_makespan: float = 0.35
    weight_deadline_compliance: float = 0.35
    weight_setups: float = 0.15
    weight_balance: float = 0.15

    # Risk parameters
    risk_oee_alpha: float = 10.6
    risk_oee_beta: float = 5.5
    risk_setup_cv: float = 0.20
    risk_processing_cv: float = 0.10

    # Production defaults
    oee_default: float = 0.66
