"""add check constraints

Revision ID: 20260322_0100
Revises: 20260317_0100
Create Date: 2026-03-22 01:00:00.000000

"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260322_0100"
down_revision = "20260317_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_check_constraint("ck_workorder_quantity_nonneg", "workorders", "quantity >= 0")
    op.create_check_constraint("ck_planop_quantity_nonneg", "plan_operations", "quantity >= 0")
    op.create_check_constraint(
        "ck_planop_operators_nonneg",
        "plan_operations",
        "operators_required IS NULL OR operators_required >= 0",
    )
    op.create_check_constraint("ck_rule_priority_nonneg", "rules", "priority >= 0")


def downgrade() -> None:
    op.drop_constraint("ck_rule_priority_nonneg", "rules", type_="check")
    op.drop_constraint("ck_planop_operators_nonneg", "plan_operations", type_="check")
    op.drop_constraint("ck_planop_quantity_nonneg", "plan_operations", type_="check")
    op.drop_constraint("ck_workorder_quantity_nonneg", "workorders", type_="check")
