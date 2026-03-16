"""Load leveler — port of scheduler/load-leveler.ts.

Post-scheduling pass: balance machine utilization across days.
Only moves FORWARD (to earlier days), never delays deliveries.
"""

from __future__ import annotations

from ..constants import DAY_CAP, LEVEL_HIGH_THRESHOLD, LEVEL_LOOKAHEAD, LEVEL_LOW_THRESHOLD
from ..types import Block, EMachine
from .backward_scheduler import EarliestStartEntry
from .decision_registry import DecisionRegistry


def level_load(
    blocks: list[Block],
    machines: list[EMachine],
    workdays: list[bool],
    earliest_starts: dict[str, EarliestStartEntry],
    registry: DecisionRegistry,
) -> list[Block]:
    """Level load across days by moving blocks from heavy to light days."""
    n_days = len(workdays)
    result = [b.model_copy() for b in blocks]

    w_days = [d for d in range(n_days) if workdays[d]]
    if len(w_days) < 2:
        return result

    for mach in machines:
        m_id = mach.id

        # Compute utilization
        day_utils: list[dict] = []
        for d in w_days:
            day_blocks = [
                b for b in result if b.machine_id == m_id and b.day_idx == d and b.type == "ok"
            ]
            used_min = sum(b.prod_min + b.setup_min for b in day_blocks)
            day_utils.append({"day_idx": d, "used_min": used_min, "util": used_min / DAY_CAP})

        # Heavy days sorted by utilization desc
        heavy_days = sorted(
            [du for du in day_utils if du["util"] > LEVEL_HIGH_THRESHOLD],
            key=lambda x: -x["util"],
        )

        for heavy in heavy_days:
            candidates = sorted(
                [
                    b
                    for b in result
                    if b.machine_id == m_id and b.day_idx == heavy["day_idx"] and b.type == "ok"
                ],
                key=lambda b: -b.prod_min,
            )

            for block in candidates:
                heavy_wd_idx = w_days.index(heavy["day_idx"]) if heavy["day_idx"] in w_days else -1
                if heavy_wd_idx < 0:
                    continue

                moved = False
                for look in range(1, LEVEL_LOOKAHEAD + 1):
                    if heavy_wd_idx - look < 0:
                        break
                    target_day = w_days[heavy_wd_idx - look]

                    # Can move forward?
                    if target_day >= block.day_idx:
                        continue
                    if block.type != "ok":
                        continue
                    es = earliest_starts.get(block.op_id)
                    if es and target_day < es.earliest_day_idx:
                        continue

                    # Target utilization
                    target_blocks = [
                        b
                        for b in result
                        if b.machine_id == m_id and b.day_idx == target_day and b.type == "ok"
                    ]
                    target_used = sum(b.prod_min + b.setup_min for b in target_blocks)
                    target_util = target_used / DAY_CAP

                    if target_util >= LEVEL_LOW_THRESHOLD:
                        continue

                    new_target_util = (target_used + block.prod_min + block.setup_min) / DAY_CAP
                    if new_target_util > LEVEL_HIGH_THRESHOLD:
                        continue

                    orig_day = block.day_idx
                    block.day_idx = target_day
                    block.is_leveled = True

                    registry.record(
                        type="LOAD_LEVEL",
                        op_id=block.op_id,
                        tool_id=block.tool_id,
                        machine_id=m_id,
                        day_idx=target_day,
                        shift=block.shift,
                        detail=f"Moved {block.sku} from day {orig_day} ({round(heavy['util'] * 100)}% util) to day {target_day} ({round(target_util * 100)}% util)",
                        metadata={
                            "fromDay": orig_day,
                            "toDay": target_day,
                            "fromUtil": heavy["util"],
                            "toUtil": target_util,
                            "prodMin": block.prod_min,
                        },
                    )
                    moved = True
                    break

                if moved:
                    updated_used = sum(
                        b.prod_min + b.setup_min
                        for b in result
                        if b.machine_id == m_id and b.day_idx == heavy["day_idx"] and b.type == "ok"
                    )
                    heavy["used_min"] = updated_used
                    heavy["util"] = updated_used / DAY_CAP
                    if heavy["util"] <= LEVEL_HIGH_THRESHOLD:
                        break

    return result
