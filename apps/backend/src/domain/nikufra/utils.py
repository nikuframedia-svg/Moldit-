from __future__ import annotations

from typing import Any


def nikufra_to_plan_state(nikufra_data: dict[str, Any]) -> dict[str, Any]:
    """Convert parsed NikufraData into dict for transform_plan_state."""
    operations = nikufra_data.get("operations", [])
    tools = nikufra_data.get("tools", [])
    tool_lookup: dict[str, dict[str, Any]] = {t["id"]: t for t in tools}

    enriched_ops: list[dict[str, Any]] = []
    for op in operations:
        tool_info = tool_lookup.get(op.get("t", ""), {})
        enriched_ops.append(
            {
                "id": op.get("id", ""),
                "m": op.get("m", ""),
                "t": op.get("t", ""),
                "sku": op.get("sku", ""),
                "nm": op.get("nm", ""),
                "pH": op.get("pH", 100),
                "atr": op.get("atr", 0),
                "d": op.get("d", []),
                "op": op.get("op", 1),
                "sH": op.get("s", tool_info.get("s", 0.75)),
                "alt": tool_info.get("alt", "-"),
                "eco": tool_info.get("lt", 0),
                "twin": op.get("twin"),
                "cl": op.get("cl"),
                "clNm": op.get("clNm"),
                "pa": op.get("pa"),
                "ltDays": op.get("ltDays"),
            }
        )

    return {
        "operations": enriched_ops,
        "dates": nikufra_data.get("dates", []),
        "dnames": nikufra_data.get("days_label", []),
    }
