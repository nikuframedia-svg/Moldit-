"""Multi-client merge — Spec 01 §4.

Same (sku, machine, tool) from different clients → merge into single EOp.
94 linhas → ~59 ops após merge (ISOP 27/02).
"""

from __future__ import annotations

from collections import defaultdict

from backend.types import EOp


def merge_multi_client(ops: list[EOp]) -> list[EOp]:
    """Merge operations with same (sku, machine, tool) from different clients.

    Merge rules:
    - d: sum per day
    - client: join sorted unique names
    - pH: min (conservative)
    - operators: max
    - eco_lot: max
    - stk: max
    - backlog: sum
    - wip: max
    - Other fields: from first op (base)
    """
    groups: dict[tuple[str, str, str], list[EOp]] = defaultdict(list)
    for op in ops:
        groups[(op.sku, op.m, op.t)].append(op)

    merged: list[EOp] = []

    for _key, group in groups.items():
        if len(group) == 1:
            merged.append(group[0])
            continue

        base = group[0]
        n = max(len(op.d) for op in group)

        d = [0] * n
        for op in group:
            for i, v in enumerate(op.d):
                if i < n:
                    d[i] += v

        merged.append(
            EOp(
                id=base.id,
                sku=base.sku,
                client=", ".join(sorted({op.client for op in group})),
                designation=base.designation,
                m=base.m,
                t=base.t,
                pH=min(op.pH for op in group),
                sH=base.sH,
                operators=max(op.operators for op in group),
                eco_lot=max(op.eco_lot for op in group),
                alt=base.alt,
                stk=max(op.stk for op in group),
                backlog=sum(op.backlog for op in group),
                d=d,
                oee=base.oee,
                wip=max(op.wip for op in group),
            )
        )

    return merged
