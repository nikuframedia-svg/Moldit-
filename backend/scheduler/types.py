"""Scheduler types — Spec 02 §2."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class Lot:
    """Production unit — output of Phase 1 (lot sizing)."""

    id: str
    op_id: str                # EOp.id de origem
    tool_id: str
    machine_id: str           # primária
    alt_machine_id: str | None
    qty: int                  # peças (eco lot rounded)
    prod_min: float           # minutos de produção
    setup_min: float          # minutos de setup (do YAML)
    edd: int                  # deadline (day_idx)
    is_twin: bool
    twin_outputs: list[tuple[str, str, int]] | None = None  # [(op_id, sku, qty)]


@dataclass(slots=True)
class ToolRun:
    """Group of lots sharing the same tool+machine — output of Phase 2."""

    id: str
    tool_id: str
    machine_id: str
    alt_machine_id: str | None
    lots: list[Lot]           # ordered by EDD
    setup_min: float          # ONE setup for the whole group
    total_prod_min: float     # sum of prod_min
    total_min: float          # setup + prod
    edd: int                  # EDD of most urgent lot
    lst: int = 0             # Latest Start Time (filled in Phase 4)


@dataclass(slots=True)
class Segment:
    """Scheduled block on Gantt — output of Phase 3."""

    lot_id: str
    run_id: str               # ToolRun de origem
    machine_id: str
    tool_id: str
    day_idx: int
    start_min: int            # minute in day (clock from midnight)
    end_min: int
    shift: str                # "A" or "B"
    qty: int
    prod_min: float
    setup_min: float = 0.0    # >0 ONLY on first segment of ToolRun
    is_continuation: bool = False
    edd: int = 0
    sku: str = ""
    twin_outputs: list[tuple[str, str, int]] | None = None


@dataclass
class MachineState:
    """Tracks machine availability during dispatch."""

    machine_id: str
    group: str
    available_at: float = 0.0   # absolute minute in scheduling timeline
    last_tool: str = ""
    used_per_day: dict[int, float] = field(default_factory=dict)


@dataclass
class CrewState:
    """Single setup crew — tracks when crew is free."""

    available_at: float = 0.0


@dataclass
class ToolTimeline:
    """Tracks which machine a tool is on to prevent simultaneous use."""

    bookings: dict[str, list[tuple[float, float, str]]] = field(default_factory=dict)

    def is_available(self, tool_id: str, at_time: float, machine_id: str) -> bool:
        """Check if tool is available (not booked on another machine at this time)."""
        for start, end, booked_machine in self.bookings.get(tool_id, []):
            if booked_machine != machine_id and start <= at_time < end:
                return False
        return True

    def book(self, tool_id: str, start: float, end: float, machine_id: str) -> None:
        """Book a tool on a machine for a time range."""
        if tool_id not in self.bookings:
            self.bookings[tool_id] = []
        self.bookings[tool_id].append((start, end, machine_id))


@dataclass(slots=True)
class OperatorAlert:
    """Advisory alert when operator demand exceeds shift capacity."""

    day_idx: int
    date: str
    shift: str
    machine_group: str
    required: int
    available: int
    deficit: int


@dataclass(slots=True)
class ScheduleResult:
    """Complete scheduler output."""

    segments: list[Segment]
    lots: list[Lot]
    score: dict
    time_ms: float
    warnings: list[str]
    operator_alerts: list[OperatorAlert]
    audit_trail: object | None = None  # AuditTrail when audit=True
    study: object | None = None  # StudyResult when smart_schedule(learn=True)
    journal: list[dict] | None = None  # Spec 12: structured phase telemetry
