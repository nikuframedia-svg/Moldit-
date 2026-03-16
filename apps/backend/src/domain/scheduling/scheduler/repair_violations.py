"""Schedule violation repair — port of scheduler/repair-violations.ts.

Post-scheduling safety net: fix setup overlaps and overcapacity.
"""

from __future__ import annotations

from ..constants import DAY_CAP, MINUTES_PER_DAY, S0, S2
from ..types import Block


def _repair_setup_overlaps(blocks: list[Block]) -> int:
    """Fix setup crew overlaps by delaying later setups."""
    with_setup = [
        b for b in blocks if b.setup_s is not None and b.setup_e is not None and b.type == "ok"
    ]
    if len(with_setup) < 2:
        return 0

    with_setup.sort(key=lambda b: b.day_idx * MINUTES_PER_DAY + (b.setup_s or 0))

    booked: list[dict] = []
    repaired = 0

    for block in with_setup:
        abs_start = block.day_idx * MINUTES_PER_DAY + block.setup_s
        setup_dur = block.setup_e - block.setup_s

        candidate = abs_start
        changed = True
        iters = 0
        while changed and iters < 200:
            changed = False
            iters += 1
            for s in booked:
                if s["machineId"] == block.machine_id:
                    continue
                if candidate < s["end"] and candidate + setup_dur > s["start"]:
                    candidate = s["end"]
                    changed = True

        booked.append(
            {"start": candidate, "end": candidate + setup_dur, "machineId": block.machine_id}
        )

        if candidate != abs_start:
            new_day = candidate // MINUTES_PER_DAY
            new_setup_s = candidate % MINUTES_PER_DAY
            new_setup_e = new_setup_s + setup_dur
            prod_dur = block.end_min - block.start_min

            block.day_idx = new_day
            block.setup_s = new_setup_s
            block.setup_e = new_setup_e
            block.start_min = new_setup_e
            block.end_min = new_setup_e + prod_dur

            day_end = 1440
            if block.end_min > day_end:
                clipped = block.end_min - day_end
                block.end_min = day_end
                block.prod_min = max(0, block.prod_min - clipped)
                if block.qty > 0 and block.prod_min > 0:
                    block.qty = round(block.qty * (block.prod_min / prod_dur))

            repaired += 1

    return repaired


def _repair_overcapacity(
    blocks: list[Block],
    third_shift: bool = False,
    overtime_map: dict[str, dict[int, int]] | None = None,
) -> int:
    """Fix machine overcapacity by clipping the last block on overloaded days."""
    base_cap = S2 - S0 if third_shift else DAY_CAP
    repaired = 0

    md_map: dict[str, list[Block]] = {}
    for b in blocks:
        if b.type != "ok":
            continue
        key = f"{b.machine_id}:{b.day_idx}"
        if key not in md_map:
            md_map[key] = []
        md_map[key].append(b)

    for key, day_blocks in md_map.items():
        parts = key.split(":")
        machine_id, day_idx = parts[0], int(parts[1])

        total_min = 0
        for b in day_blocks:
            total_min += b.end_min - b.start_min
            if b.setup_s is not None and b.setup_e is not None:
                total_min += b.setup_e - b.setup_s

        ot = overtime_map.get(machine_id, {}).get(day_idx, 0) if overtime_map else 0
        e_day_cap = base_cap + ot

        if round(total_min) <= e_day_cap:
            continue

        excess = round(total_min) - e_day_cap
        day_blocks.sort(key=lambda b: -b.end_min)
        victim = day_blocks[0]

        prod_dur = victim.end_min - victim.start_min
        clip_min = min(excess, prod_dur)

        if clip_min >= prod_dur:
            victim.type = "overflow"
        else:
            new_prod = prod_dur - clip_min
            if victim.qty > 0 and prod_dur > 0:
                victim.qty = round(victim.qty * (new_prod / prod_dur))
            victim.end_min -= clip_min
            victim.prod_min = max(0, victim.prod_min - clip_min)

            overflow_block = victim.model_copy()
            overflow_block.start_min = victim.end_min
            overflow_block.end_min = victim.end_min + clip_min
            overflow_block.qty = (
                round((victim.qty / max(1, new_prod)) * clip_min) if victim.qty > 0 else 0
            )
            overflow_block.prod_min = clip_min
            overflow_block.setup_min = 0
            overflow_block.setup_s = None
            overflow_block.setup_e = None
            overflow_block.type = "overflow"
            blocks.append(overflow_block)

        repaired += 1

    return repaired


def repair_schedule_violations(
    blocks: list[Block],
    third_shift: bool = False,
    overtime_map: dict[str, dict[int, int]] | None = None,
) -> tuple[list[Block], int, int]:
    """Post-scheduling repair pass.

    Returns (blocks, setup_repairs, capacity_repairs).
    """
    result = [b.model_copy() for b in blocks]
    setup_repairs = _repair_setup_overlaps(result)
    capacity_repairs = _repair_overcapacity(result, third_shift, overtime_map)
    return result, setup_repairs, capacity_repairs
