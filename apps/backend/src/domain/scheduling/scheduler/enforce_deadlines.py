"""Enforce deadlines (Step 7.5) — port of scheduler/enforce-deadlines.ts.

Converts overflow blocks to infeasible when demand not met.
Generates remediation proposals.
"""

from __future__ import annotations

from ..types import Block, EOp, ETool, InfeasibilityEntry


class RemediationProposal:
    __slots__ = (
        "type",
        "op_id",
        "tool_id",
        "machine_id",
        "capacity_gain_min",
        "automated",
        "description",
    )

    def __init__(
        self,
        *,
        type: str,
        op_id: str,
        tool_id: str,
        machine_id: str,
        capacity_gain_min: float,
        automated: bool,
        description: str,
    ) -> None:
        self.type = type
        self.op_id = op_id
        self.tool_id = tool_id
        self.machine_id = machine_id
        self.capacity_gain_min = capacity_gain_min
        self.automated = automated
        self.description = description


def _get_block_production_for_op(blocks: list[Block], op_id: str) -> int:
    """Sum production qty for an op across all 'ok' blocks."""
    total = 0
    for b in blocks:
        if b.op_id == op_id and b.type == "ok" and b.qty > 0:
            total += b.qty
        # Twin co-production: count outputs for this op
        if b.outputs:
            for out in b.outputs:
                if out.op_id == op_id and b.type == "ok":
                    total += out.qty
    return total


def enforce_deadlines(
    ops: list[EOp],
    blocks: list[Block],
    tool_map: dict[str, ETool],
    m_st: dict[str, str],
    t_st: dict[str, str],
    third_shift: bool = False,
) -> tuple[list[InfeasibilityEntry], list[RemediationProposal]]:
    """Convert overflow → infeasible when demand not met.

    Returns (infeasibilities, remediations).
    """
    infeasibilities: list[InfeasibilityEntry] = []
    remediations: list[RemediationProposal] = []

    for op in ops:
        total_demand = sum(max(v, 0) for v in op.d) + max(op.atr, 0)
        if total_demand <= 0:
            continue
        produced = _get_block_production_for_op(blocks, op.id)

        if produced < total_demand:
            tool = tool_map.get(op.t)
            deficit = total_demand - produced
            deficit_min = (deficit / tool.pH) * 60 if tool and tool.pH > 0 else 0

            # Convert overflow blocks to infeasible
            for b in blocks:
                if b.op_id == op.id and b.type == "overflow":
                    b.type = "infeasible"

                    if m_st.get(b.machine_id) == "down":
                        b.infeasibility_reason = "MACHINE_DOWN"
                        b.infeasibility_detail = f"Máquina {b.machine_id} parada. Deficit {deficit}"
                    elif t_st.get(b.tool_id) == "down":
                        b.infeasibility_reason = "TOOL_DOWN_TEMPORAL"
                        b.infeasibility_detail = f"Ferramenta {b.tool_id} parada. Deficit {deficit}"
                    else:
                        b.infeasibility_reason = "CAPACITY_OVERFLOW"
                        b.infeasibility_detail = f"Capacidade esgotada em {b.machine_id}. Procura {total_demand}, produzido {produced}, deficit {deficit}"

            # Remediation proposals
            if not third_shift:
                remediations.append(
                    RemediationProposal(
                        type="THIRD_SHIFT",
                        op_id=op.id,
                        tool_id=op.t,
                        machine_id=op.m,
                        capacity_gain_min=420,
                        automated=False,
                        description=f"Activar 3.º turno em {op.m} — +420 min/dia",
                    )
                )
            if tool and tool.alt and tool.alt != "-":
                remediations.append(
                    RemediationProposal(
                        type="TRANSFER_ALT_MACHINE",
                        op_id=op.id,
                        tool_id=op.t,
                        machine_id=tool.alt,
                        capacity_gain_min=deficit_min,
                        automated=True,
                        description=f"Mover {op.t} para {tool.alt}",
                    )
                )
            remediations.append(
                RemediationProposal(
                    type="ADVANCE_PRODUCTION",
                    op_id=op.id,
                    tool_id=op.t,
                    machine_id=op.m,
                    capacity_gain_min=deficit_min,
                    automated=True,
                    description=f"Antecipar produção de {op.t}/{op.sku} — {deficit} pcs",
                )
            )
            remediations.append(
                RemediationProposal(
                    type="FORMAL_RISK_ACCEPTANCE",
                    op_id=op.id,
                    tool_id=op.t,
                    machine_id=op.m,
                    capacity_gain_min=0,
                    automated=False,
                    description=f"Aceitar atraso de {deficit} pcs em {op.sku} — requer aprovação formal",
                )
            )

            # Infeasibility entry
            op_inf_blocks = [b for b in blocks if b.op_id == op.id and b.type == "infeasible"]
            dominant_reason = (
                op_inf_blocks[0].infeasibility_reason
                if op_inf_blocks and op_inf_blocks[0].infeasibility_reason
                else "DEADLINE_VIOLATION"
            )

            infeasibilities.append(
                InfeasibilityEntry(
                    op_id=op.id,
                    tool_id=op.t,
                    machine_id=op.m,
                    reason=dominant_reason,
                    detail=f"Demand {total_demand}, produced {produced}, deficit {deficit}",
                    attempted_alternatives=["Slot allocation", "Load leveling"],
                    suggestion="; ".join(r.description for r in remediations if r.op_id == op.id),
                )
            )

    return infeasibilities, remediations
