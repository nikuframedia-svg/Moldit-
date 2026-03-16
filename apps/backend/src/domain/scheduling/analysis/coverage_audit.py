"""Coverage audit — port of analysis/coverage-audit.ts.

Per-operation demand coverage verification.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..types import Block, EOp, ETool, TwinGroup


@dataclass
class CoverageAuditRow:
    op_id: str
    sku: str
    nm: str = ""
    machine_id: str = ""
    tool_id: str = ""
    total_demand: int = 0
    produced: int = 0
    coverage_pct: float = 0
    gap: int = 0
    reason: str = "ok"  # ok, overflow, blocked, partial, rate_zero, no_demand
    has_alt: bool = False
    alt_m: str | None = None
    is_twin_production: bool = False
    twin_partner_op_id: str | None = None
    twin_excess_to_stock: int = 0


@dataclass
class CoverageAuditResult:
    rows: list[CoverageAuditRow] = field(default_factory=list)
    total_demand: int = 0
    total_produced: int = 0
    global_coverage_pct: float = 0
    fully_covered: int = 0
    partially_covered: int = 0
    zero_covered: int = 0
    is_complete: bool = True


def _get_block_production_for_op(blocks: list[Block], op_id: str) -> int:
    total = 0
    for b in blocks:
        if b.type != "ok" or b.qty <= 0:
            continue
        if b.op_id == op_id:
            total += b.qty
        if b.outputs:
            for out in b.outputs:
                if out.op_id == op_id:
                    total += out.qty
    return total


def audit_coverage(
    blocks: list[Block],
    ops: list[EOp],
    tool_map: dict[str, ETool],
    twin_groups: list[TwinGroup] | None = None,
) -> CoverageAuditResult:
    """Audit per-op demand coverage."""
    rows: list[CoverageAuditRow] = []
    total_demand = 0
    total_produced = 0
    fully_covered = 0
    partially_covered = 0
    zero_covered = 0

    # Build twin partner map
    twin_partner: dict[str, str] = {}
    if twin_groups:
        for tg in twin_groups:
            twin_partner[tg.op_id1] = tg.op_id2
            twin_partner[tg.op_id2] = tg.op_id1

    for op in ops:
        demand = sum(max(v, 0) for v in op.d) + max(op.atr, 0)

        if demand <= 0:
            rows.append(
                CoverageAuditRow(
                    op_id=op.id,
                    sku=op.sku,
                    nm=op.nm,
                    machine_id=op.m,
                    tool_id=op.t,
                    total_demand=0,
                    produced=0,
                    coverage_pct=100.0,
                    gap=0,
                    reason="no_demand",
                )
            )
            fully_covered += 1
            continue

        total_demand += demand

        tool = tool_map.get(op.t)
        if not tool or tool.pH <= 0:
            rows.append(
                CoverageAuditRow(
                    op_id=op.id,
                    sku=op.sku,
                    nm=op.nm,
                    machine_id=op.m,
                    tool_id=op.t,
                    total_demand=demand,
                    produced=0,
                    coverage_pct=0,
                    gap=demand,
                    reason="rate_zero",
                )
            )
            zero_covered += 1
            continue

        produced = _get_block_production_for_op(blocks, op.id)
        total_produced += produced

        pct = min(100.0, (produced / demand * 100.0) if demand > 0 else 100.0)
        gap = max(0, demand - produced)

        # Classify reason
        has_blocked = any(b.op_id == op.id and b.type == "blocked" for b in blocks)
        has_overflow = any(b.op_id == op.id and b.overflow for b in blocks)

        if pct >= 100:
            reason = "ok"
        elif has_blocked:
            reason = "blocked"
        elif has_overflow:
            reason = "overflow"
        else:
            reason = "partial"

        # Twin metadata
        is_twin = any(b.op_id == op.id and b.is_twin_production and b.type == "ok" for b in blocks)
        tp_op_id = twin_partner.get(op.id)
        excess = max(0, produced - demand) if is_twin else 0

        has_alt = tool.alt != "-" if tool.alt else False
        alt_m = tool.alt if has_alt else None

        rows.append(
            CoverageAuditRow(
                op_id=op.id,
                sku=op.sku,
                nm=op.nm,
                machine_id=op.m,
                tool_id=op.t,
                total_demand=demand,
                produced=produced,
                coverage_pct=round(pct, 1),
                gap=gap,
                reason=reason,
                has_alt=has_alt,
                alt_m=alt_m,
                is_twin_production=is_twin,
                twin_partner_op_id=tp_op_id,
                twin_excess_to_stock=excess,
            )
        )

        if produced >= demand:
            fully_covered += 1
        elif produced > 0:
            partially_covered += 1
        else:
            zero_covered += 1

    global_pct = min(100.0, (total_produced / total_demand * 100.0) if total_demand > 0 else 100.0)

    return CoverageAuditResult(
        rows=rows,
        total_demand=total_demand,
        total_produced=total_produced,
        global_coverage_pct=round(global_pct, 1),
        fully_covered=fully_covered,
        partially_covered=partially_covered,
        zero_covered=zero_covered,
        is_complete=total_produced >= total_demand,
    )
