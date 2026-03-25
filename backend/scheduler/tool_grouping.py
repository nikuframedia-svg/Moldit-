"""Phase 2 — Tool Grouping: Spec 02 v6 §4.

Groups Lots by (tool_id, machine_id) into ToolRuns.
1 setup covers all lots in the group. Lots produced sequentially.

Fix 1: Lots within each ToolRun are ALWAYS sorted by EDD.

Splits runs on two criteria:
  1. EDD gap > MAX_EDD_GAP between consecutive lots
  2. Cumulative production time > MAX_RUN_DAYS * DAY_CAP
"""

from __future__ import annotations

from collections import defaultdict

from backend.config.types import FactoryConfig
from backend.scheduler.constants import DAY_CAP, MAX_EDD_GAP, MAX_RUN_DAYS
from backend.scheduler.types import Lot, ToolRun


def create_tool_runs(
    lots: list[Lot],
    max_edd_gap: int = MAX_EDD_GAP,
    audit_logger: object | None = None,
    params: object | None = None,
    config: FactoryConfig | None = None,
) -> list[ToolRun]:
    """Group lots by (tool_id, machine_id) into ToolRuns, with splitting."""
    day_cap = config.day_capacity_min if config else DAY_CAP

    groups: dict[tuple[str, str], list[Lot]] = defaultdict(list)

    for lot in lots:
        key = (lot.tool_id, lot.machine_id)
        groups[key].append(lot)

    runs: list[ToolRun] = []
    for (tool, machine), group_lots in groups.items():
        group_lots.sort(key=lambda x: x.edd)  # Fix 1: always EDD sorted
        gap = getattr(params, 'max_edd_gap', config.max_edd_gap if config else max_edd_gap)
        max_run = getattr(params, 'max_run_days', config.max_run_days if config else MAX_RUN_DAYS)
        sub_runs = _split_by_edd_gap(group_lots, gap, max_run, day_cap=day_cap)

        for idx, sub_lots in enumerate(sub_runs):
            setup = sub_lots[0].setup_min
            total_prod = sum(lot.prod_min for lot in sub_lots)

            runs.append(ToolRun(
                id=f"run_{tool}_{machine}_{idx}",
                tool_id=tool,
                machine_id=machine,
                alt_machine_id=sub_lots[0].alt_machine_id,
                lots=sub_lots,
                setup_min=setup,
                total_prod_min=total_prod,
                total_min=setup + total_prod,
                edd=sub_lots[0].edd,
            ))

    before_count = len(runs)
    runs = _split_infeasible_runs(runs, day_cap=day_cap)

    # Log infeasibility splits
    if audit_logger and len(runs) > before_count:
        for run in runs:
            if run.id.endswith("_early"):
                original_id = run.id.removesuffix("_early")
                late = next((r for r in runs if r.id == f"{original_id}_late"), None)
                audit_logger.log_split(
                    original_id, "infeasible",
                    len(run.lots), len(late.lots) if late else 0,
                    total_min=run.total_min + (late.total_min if late else 0),
                    capacity=(run.edd + 1) * day_cap,
                )

    return runs


def _split_by_edd_gap(
    lots: list[Lot], max_gap: int, max_run_days: int = MAX_RUN_DAYS,
    day_cap: int = DAY_CAP,
) -> list[list[Lot]]:
    """Split sorted lots by EDD gap and max cumulative production time."""
    if not lots:
        return []
    if len(lots) <= 1:
        return [lots]

    max_prod = max_run_days * day_cap
    sub_runs: list[list[Lot]] = [[lots[0]]]
    cum_prod = lots[0].prod_min

    for lot in lots[1:]:
        prev_edd = sub_runs[-1][-1].edd
        gap = lot.edd - prev_edd
        duration_split = cum_prod + lot.prod_min > max_prod

        if gap > max_gap or duration_split:
            sub_runs.append([lot])
            cum_prod = lot.prod_min
        else:
            sub_runs[-1].append(lot)
            cum_prod += lot.prod_min

    return sub_runs


def _make_run(original: ToolRun, lots: list[Lot], run_id: str) -> ToolRun:
    """Create a new ToolRun from a subset of lots."""
    setup = lots[0].setup_min
    total_prod = sum(lot.prod_min for lot in lots)
    return ToolRun(
        id=run_id,
        tool_id=original.tool_id,
        machine_id=original.machine_id,
        alt_machine_id=original.alt_machine_id,
        lots=lots,
        setup_min=setup,
        total_prod_min=total_prod,
        total_min=setup + total_prod,
        edd=lots[0].edd,
    )


def _split_infeasible_runs(runs: list[ToolRun], day_cap: int = DAY_CAP) -> list[ToolRun]:
    """Split runs where total_min exceeds capacity available by their EDD.

    If a run needs more time than (edd+1)*day_cap, the early-EDD lots are
    separated into their own run so they can potentially be routed to an
    alt machine or scheduled earlier.
    """
    result: list[ToolRun] = []
    for run in runs:
        capacity_by_edd = (run.edd + 1) * day_cap
        if run.total_min <= capacity_by_edd or len(run.lots) <= 1:
            result.append(run)
            continue

        early_lots: list[Lot] = []
        late_lots: list[Lot] = []
        cum = 0.0
        for lot in run.lots:  # already EDD-sorted
            if lot.edd <= run.edd and cum + lot.prod_min + run.setup_min <= capacity_by_edd:
                early_lots.append(lot)
                cum += lot.prod_min
            else:
                late_lots.append(lot)

        if early_lots and late_lots:
            result.append(_make_run(run, early_lots, f"{run.id}_early"))
            result.append(_make_run(run, late_lots, f"{run.id}_late"))
        else:
            result.append(run)

    return result
