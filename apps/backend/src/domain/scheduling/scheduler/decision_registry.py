"""DecisionRegistry — lightweight audit trail for scheduling decisions.

Port of decisions/decision-registry.ts.
"""

from __future__ import annotations

import time
import uuid
from typing import Any

from ..types import DecisionEntry, ShiftId


class DecisionRegistry:
    """Append-only decision log. Records every scheduling decision."""

    def __init__(self) -> None:
        self._entries: list[DecisionEntry] = []

    def record(
        self,
        *,
        type: str,
        op_id: str | None = None,
        tool_id: str | None = None,
        machine_id: str | None = None,
        day_idx: int | None = None,
        shift: ShiftId | None = None,
        detail: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> DecisionEntry:
        entry = DecisionEntry(
            id=str(uuid.uuid4()),
            timestamp=time.time(),
            type=type,
            op_id=op_id,
            tool_id=tool_id,
            machine_id=machine_id,
            day_idx=day_idx,
            shift=shift,
            detail=detail,
            metadata=metadata or {},
        )
        self._entries.append(entry)
        return entry

    def get_all(self) -> list[DecisionEntry]:
        return list(self._entries)

    def clear(self) -> None:
        self._entries.clear()
