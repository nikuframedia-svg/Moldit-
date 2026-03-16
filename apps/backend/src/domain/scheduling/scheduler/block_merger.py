"""Block merger — port of scheduler/block-merger.ts.

Merges consecutive blocks for the same operation on the same
machine/day/shift into single continuous blocks.
"""

from __future__ import annotations

from ..types import Block


def merge_consecutive_blocks(blocks: list[Block]) -> list[Block]:
    """Merge adjacent 'ok' blocks with same op/tool/machine/day/shift."""
    merged: list[Block] = []

    for b in blocks:
        prev = merged[-1] if merged else None

        if (
            prev is not None
            and prev.op_id == b.op_id
            and prev.tool_id == b.tool_id
            and prev.machine_id == b.machine_id
            and prev.day_idx == b.day_idx
            and prev.shift == b.shift
            and prev.end_min == b.start_min
            and prev.type == "ok"
            and b.type == "ok"
            and (prev.co_production_group_id or None) == (b.co_production_group_id or None)
        ):
            # Merge into previous
            prev.end_min = b.end_min
            prev.prod_min += b.prod_min
            prev.qty += b.qty

            # Merge twin outputs
            if prev.outputs and b.outputs:
                for i, po in enumerate(prev.outputs):
                    b_out = next((o for o in b.outputs if o.op_id == po.op_id), None)
                    if b_out:
                        prev.outputs[i].qty += b_out.qty

            # Merge data gap
            if b.has_data_gap and not prev.has_data_gap:
                prev.has_data_gap = True
                prev.data_gap_detail = b.data_gap_detail
        else:
            merged.append(b.model_copy())

    return merged
