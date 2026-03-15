"""Tests for twin parts merge logic."""

from datetime import date

from src.engine.twin import merge_twin_orders


def _order(sku: str, qty: int, deadline: str = "2026-04-01", **kw) -> dict:
    return {
        "sku": sku,
        "qty": qty,
        "deadline": date.fromisoformat(deadline),
        "machine": kw.get("machine", "PRM019"),
        "tool": kw.get("tool", "T01"),
        "pieces_per_hour": kw.get("pieces_per_hour", 1000),
        "clients": kw.get("clients", ["C1"]),
    }


class TestMergeTwinOrders:
    def test_no_twins_passthrough(self):
        orders = [_order("SKU1", 100), _order("SKU2", 200)]
        result = merge_twin_orders(orders, [])
        assert len(result) == 2
        assert all(not o["is_twin"] for o in result)

    def test_twin_pair_same_deadline_merged(self):
        orders = [
            _order("SKU_A", 500, "2026-04-10"),
            _order("SKU_B", 300, "2026-04-10"),
        ]
        result = merge_twin_orders(orders, [("SKU_A", "SKU_B")])
        twins = [o for o in result if o["is_twin"]]
        assert len(twins) == 1
        merged = twins[0]
        assert merged["qty"] == 500  # max(500, 300)
        assert len(merged["twin_outputs"]) == 2

    def test_twin_qty_is_max(self):
        orders = [
            _order("SKU_A", 100, "2026-04-05"),
            _order("SKU_B", 9000, "2026-04-05"),
        ]
        result = merge_twin_orders(orders, [("SKU_A", "SKU_B")])
        twins = [o for o in result if o["is_twin"]]
        assert twins[0]["qty"] == 9000  # max(100, 9000)

    def test_unpaired_twin_passes_through(self):
        """If only one side of a twin pair has an order, it still passes through."""
        orders = [_order("SKU_A", 500, "2026-04-10")]
        result = merge_twin_orders(orders, [("SKU_A", "SKU_B")])
        assert len(result) == 1
        assert result[0]["is_twin"] is True
        assert result[0]["qty"] == 500

    def test_twin_different_deadlines_separate(self):
        """Twin orders with different deadlines are NOT merged."""
        orders = [
            _order("SKU_A", 500, "2026-04-10"),
            _order("SKU_B", 300, "2026-04-15"),
        ]
        result = merge_twin_orders(orders, [("SKU_A", "SKU_B")])
        twins = [o for o in result if o["is_twin"]]
        assert len(twins) == 2  # separate because different deadlines

    def test_mixed_twin_and_non_twin(self):
        orders = [
            _order("SKU_A", 500, "2026-04-10"),
            _order("SKU_B", 300, "2026-04-10"),
            _order("SKU_C", 700, "2026-04-12"),
        ]
        result = merge_twin_orders(orders, [("SKU_A", "SKU_B")])
        assert len(result) == 2  # 1 merged twin + 1 standalone
        non_twins = [o for o in result if not o["is_twin"]]
        assert len(non_twins) == 1
        assert non_twins[0]["sku"] == "SKU_C"

    def test_twin_outputs_preserve_individual_qty(self):
        orders = [
            _order("SKU_A", 500, "2026-04-10"),
            _order("SKU_B", 300, "2026-04-10"),
        ]
        result = merge_twin_orders(orders, [("SKU_A", "SKU_B")])
        twins = [o for o in result if o["is_twin"]]
        outputs = twins[0]["twin_outputs"]
        qtys = {o["sku"]: o["qty"] for o in outputs}
        assert qtys["SKU_A"] == 500
        assert qtys["SKU_B"] == 300
